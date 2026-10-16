/*
 * blesim: the Mac as a WonderGate Bluetooth module.
 *
 * wgcore (the adapter) + wg_tunnel (its sockets over the tunnel protocol) +
 * a CoreBluetooth peripheral with the module's GATT service. The phone app
 * (or the Web Bluetooth page) connects to it exactly as to real hardware.
 * Spec: docs/wondergate-ble-protocol.md.
 *
 *   Mednafen:  stdin/stdout are the console's serial line (wswan.excomm.path;
 *              Mednafen passes a dummy argument). Logs never go to stdout.
 *   Hardware:  --serial /dev/cu.usbmodemXXXX through an ExtFriend-compatible
 *              dongle, as wgcore-host.
 *
 * Usage: blesim [--config FILE] [--log FILE] [--serial DEV [--baud 9600|38400]]
 *               [--name NAME] [--phone-log events|all|none] [--quiet]
 *
 * Threads: CoreBluetooth runs on its own serial dispatch queue; wgcore and
 * the tunnel run on the main (console) thread. Phone messages and link
 * changes cross over through an inbox (mutex + condvar) that the tunnel's
 * pump waits on; outgoing messages are queued on the CoreBluetooth queue and
 * sent as notifications as fast as updateValue allows.
 */
#import <CoreBluetooth/CoreBluetooth.h>
#import <Foundation/Foundation.h>

#include "wg.h"
#include "wg_posix.h"
#include "wg_tunnel.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <mach-o/dyld.h>
#include <spawn.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define FRAME_GAP_MS 500
#define LOOP_MS      50

static NSString *const SERVICE_UUID = @"06904a01-fe90-45b2-9d6e-409bc479cabf";
static NSString *const RX_UUID      = @"06904a02-fe90-45b2-9d6e-409bc479cabf";
static NSString *const TX_UUID      = @"06904a03-fe90-45b2-9d6e-409bc479cabf";
static NSString *const INFO_UUID    = @"06904a04-fe90-45b2-9d6e-409bc479cabf";

/* ---- logging (both threads) ---- */

enum { PL_NONE, PL_EVENTS, PL_ALL };

static pthread_mutex_t log_mu = PTHREAD_MUTEX_INITIALIZER;
static FILE *logfile;
static int   log_stderr = 1;
static int   phone_log = PL_EVENTS;
static pthread_t console_thread;
static wgt   tun;

static void log_line(const char *line)
{
  struct timeval tv;
  struct tm tm;
  char ts[32];

  gettimeofday(&tv, NULL);
  localtime_r(&tv.tv_sec, &tm);
  strftime(ts, sizeof ts, "%H:%M:%S", &tm);
  pthread_mutex_lock(&log_mu);
  if (log_stderr)
    fprintf(stderr, "%s.%03d %s\n", ts, (int)(tv.tv_usec / 1000), line);
  if (logfile) {
    fprintf(logfile, "%s.%03d %s\n", ts, (int)(tv.tv_usec / 1000), line);
    fflush(logfile);
  }
  pthread_mutex_unlock(&log_mu);
  /* Module log to the phone (LOG), for bring-up. Only from the console
   * thread, which owns the tunnel; frame hex dumps only with --phone-log all. */
  if (phone_log != PL_NONE && pthread_equal(pthread_self(), console_thread) &&
      (phone_log == PL_ALL || (strncmp(line, "<= ", 3) && strncmp(line, "=> ", 3))))
    wgt_send_log(&tun, line);
}

static void blog(const char *fmt, ...)
{
  char line[400];
  va_list ap;

  va_start(ap, fmt);
  vsnprintf(line, sizeof line, fmt, ap);
  va_end(ap);
  log_line(line);
}

/* ---- inbox: CoreBluetooth queue -> console thread ---- */

enum { IN_MSG, IN_UP, IN_DOWN };

@interface Inbound : NSObject
@property int kind;
@property uint16_t mtu;
@property uint32_t gen;
@property(strong) NSData *data;
@end
@implementation Inbound
@end

static pthread_mutex_t in_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t  in_cv = PTHREAD_COND_INITIALIZER;
static NSMutableArray<Inbound *> *inbox;

static void inbox_push(int kind, uint16_t mtu, uint32_t gen, NSData *data)
{
  Inbound *e = [Inbound new];

  e.kind = kind;
  e.mtu = mtu;
  e.gen = gen;
  e.data = data;
  pthread_mutex_lock(&in_mu);
  [inbox addObject:e];
  pthread_cond_signal(&in_cv);
  pthread_mutex_unlock(&in_mu);
}

/* ---- the peripheral (runs on cbq) ---- */

@interface Module : NSObject <CBPeripheralManagerDelegate>
@property(strong) CBPeripheralManager *pm;
@property(strong) CBMutableCharacteristic *rx, *tx, *info;
@property(strong) CBCentral *central;          /* the subscribed phone */
@property(strong) NSMutableArray<NSData *> *outq;
@property(copy) NSString *name;
@property int added;
@property uint32_t gen;                        /* link generation, bumped on every subscribe/unsubscribe */
@end

static dispatch_queue_t cbq;
static Module *module;
static uint32_t console_gen;                   /* the generation the console thread last saw come up */

@implementation Module

- (void)advertise
{
  if (self.pm.isAdvertising)
    return;
  [self.pm startAdvertising:@{
    CBAdvertisementDataServiceUUIDsKey : @[ [CBUUID UUIDWithString:SERVICE_UUID] ],
    CBAdvertisementDataLocalNameKey : self.name
  }];
}

- (void)peripheralManagerDidUpdateState:(CBPeripheralManager *)pm
{
  static const char *const names[] = { "unknown", "resetting", "unsupported", "unauthorized", "poweredOff", "poweredOn" };
  CBManagerState st = pm.state;

  blog("# ble: %s", st <= CBManagerStatePoweredOn ? names[st] : "?");
  if (st == CBManagerStateUnauthorized)
    blog("# ble: Bluetooth access denied. Allow it for the app that started blesim (Terminal, iTerm, "
         "Mednafen...) in System Settings > Privacy & Security > Bluetooth, then run it again.");
  if (st != CBManagerStatePoweredOn) {
    [self linkDown:@"Bluetooth not powered on"];
    return;
  }
  if (!self.added) {
    CBMutableService *svc = [[CBMutableService alloc] initWithType:[CBUUID UUIDWithString:SERVICE_UUID] primary:YES];
    self.rx = [[CBMutableCharacteristic alloc]
        initWithType:[CBUUID UUIDWithString:RX_UUID]
          properties:CBCharacteristicPropertyWrite | CBCharacteristicPropertyWriteWithoutResponse
               value:nil
         permissions:CBAttributePermissionsWriteable];
    self.tx = [[CBMutableCharacteristic alloc] initWithType:[CBUUID UUIDWithString:TX_UUID]
                                                 properties:CBCharacteristicPropertyNotify
                                                      value:nil
                                                permissions:CBAttributePermissionsReadable];
    self.info = [[CBMutableCharacteristic alloc] initWithType:[CBUUID UUIDWithString:INFO_UUID]
                                                   properties:CBCharacteristicPropertyRead
                                                        value:nil
                                                  permissions:CBAttributePermissionsReadable];
    svc.characteristics = @[ self.rx, self.tx, self.info ];
    self.added = 1;
    [pm addService:svc];
  } else {
    [self advertise];
  }
}

- (void)peripheralManager:(CBPeripheralManager *)pm didAddService:(CBService *)svc error:(NSError *)err
{
  if (err) {
    blog("# ble: adding the service failed: %s", err.localizedDescription.UTF8String);
    return;
  }
  [self advertise];
}

- (void)peripheralManagerDidStartAdvertising:(CBPeripheralManager *)pm error:(NSError *)err
{
  if (err)
    blog("# ble: advertising failed: %s", err.localizedDescription.UTF8String);
  else
    blog("# ble: advertising as %s", self.name.UTF8String);
}

- (void)peripheralManager:(CBPeripheralManager *)pm
                         central:(CBCentral *)c
    didSubscribeToCharacteristic:(CBCharacteristic *)ch
{
  if (![ch.UUID isEqual:self.tx.UUID])
    return;
  if (self.central && ![self.central.identifier isEqual:c.identifier]) {
    blog("# ble: a second phone subscribed; only one is served (ignored)");
    return;
  }
  [self linkDown:nil];
  self.central = c;
  self.gen++;
  [self.pm stopAdvertising];
  blog("# ble: phone %s subscribed, %lu-byte notifications", c.identifier.UUIDString.UTF8String,
       (unsigned long)c.maximumUpdateValueLength);
  inbox_push(IN_UP, (uint16_t)(c.maximumUpdateValueLength + 3), self.gen, nil);
}

- (void)peripheralManager:(CBPeripheralManager *)pm
                             central:(CBCentral *)c
    didUnsubscribeFromCharacteristic:(CBCharacteristic *)ch
{
  if ([ch.UUID isEqual:self.tx.UUID] && self.central && [self.central.identifier isEqual:c.identifier])
    [self linkDown:@"phone unsubscribed or disconnected"];
}

/* The phone is gone (or replaced): drop what was queued for it, tell the tunnel, advertise again. */
- (void)linkDown:(NSString *)why
{
  if (!self.central)
    return;
  self.central = nil;
  self.gen++;
  [self.outq removeAllObjects];
  if (why)
    blog("# ble: %s", why.UTF8String);
  inbox_push(IN_DOWN, 0, 0, nil);
  if (self.pm.state == CBManagerStatePoweredOn)
    [self advertise];
}

- (void)peripheralManager:(CBPeripheralManager *)pm didReceiveReadRequest:(CBATTRequest *)req
{
  uint8_t buf[256];
  size_t n;
  NSData *d;

  if (![req.characteristic.UUID isEqual:self.info.UUID]) {
    [pm respondToRequest:req withResult:CBATTErrorReadNotPermitted];
    return;
  }
  /* The tunnel's INFO fields are fixed after start-up, so reading them here is safe. */
  n = wgt_info(&tun, buf, sizeof buf, (uint16_t)(req.central.maximumUpdateValueLength + 3));
  if ((size_t)req.offset > n) {
    [pm respondToRequest:req withResult:CBATTErrorInvalidOffset];
    return;
  }
  d = [NSData dataWithBytes:buf length:n];
  req.value = [d subdataWithRange:NSMakeRange(req.offset, n - req.offset)];
  [pm respondToRequest:req withResult:CBATTErrorSuccess];
  if (req.offset == 0)
    blog("# ble: INFO read (MTU %lu)", (unsigned long)req.central.maximumUpdateValueLength + 3);
}

- (void)peripheralManager:(CBPeripheralManager *)pm didReceiveWriteRequests:(NSArray<CBATTRequest *> *)reqs
{
  for (CBATTRequest *r in reqs) {
    if (![r.characteristic.UUID isEqual:self.rx.UUID] || !r.value.length)
      continue;
    /* The module listens only to the subscribed phone (it subscribes before its first STATUS). */
    if (!self.central || ![r.central.identifier isEqual:self.central.identifier]) {
      blog("# ble: write from a phone that isn't subscribed, ignored");
      continue;
    }
    inbox_push(IN_MSG, 0, 0, r.value);
  }
  /* One answer for the whole batch (ignored for writes without response). */
  [pm respondToRequest:reqs.firstObject withResult:CBATTErrorSuccess];
}

- (void)drain
{
  while (self.outq.count && self.central) {
    if (![self.pm updateValue:self.outq.firstObject forCharacteristic:self.tx onSubscribedCentrals:@[ self.central ]])
      return;  /* queue full: peripheralManagerIsReadyToUpdateSubscribers: calls us again */
    [self.outq removeObjectAtIndex:0];
  }
}

- (void)peripheralManagerIsReadyToUpdateSubscribers:(CBPeripheralManager *)pm
{
  [self drain];
}

@end

/* ---- tunnel platform hooks (console thread) ---- */

static int ble_send(void *ctx, const uint8_t *msg, size_t len)
{
  NSData *d = [NSData dataWithBytes:msg length:len];
  uint32_t gen = console_gen;

  (void)ctx;
  dispatch_async(cbq, ^{
    /* Meant for an earlier connection: drop. */
    if (gen != module.gen || !module.central)
      return;
    [module.outq addObject:d];
    [module drain];
  });
  return 0;
}

static void ble_pump(void *ctx, int timeout_ms)
{
  NSArray<Inbound *> *batch;

  (void)ctx;
  pthread_mutex_lock(&in_mu);
  if (!inbox.count && timeout_ms > 0) {
    struct timespec rel = { timeout_ms / 1000, (long)(timeout_ms % 1000) * 1000000L };
    pthread_cond_timedwait_relative_np(&in_cv, &in_mu, &rel);
  }
  batch = [inbox copy];
  [inbox removeAllObjects];
  pthread_mutex_unlock(&in_mu);

  for (Inbound *e in batch) {
    switch (e.kind) {
    case IN_UP:
      /* Address our sends to this connection; anything sent under an older
       * generation is dropped on the CB queue. */
      console_gen = e.gen;
      wgt_link_up(&tun, e.mtu);
      break;
    case IN_DOWN:
      wgt_link_down(&tun);
      break;
    default:
      wgt_deliver(&tun, e.data.bytes, e.data.length);
      break;
    }
  }
}

static uint32_t ble_now(void *ctx)
{
  struct timespec ts;

  (void)ctx;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint32_t)((uint64_t)ts.tv_sec * 1000 + (uint64_t)ts.tv_nsec / 1000000);
}

static void ble_log(void *ctx, const char *line)
{
  (void)ctx;
  log_line(line);
}

/* ---- console side, as wgcore-host ---- */

static void tx_fd(void *ctx, const uint8_t *buf, size_t len)
{
  int fd = *(int *)ctx;

  while (len) {
    ssize_t n = write(fd, buf, len);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0)
      return;
    buf += n;
    len -= (size_t)n;
  }
}

static void wg_log(void *ctx, const char *line)
{
  (void)ctx;
  log_line(line);
}

static int open_serial(const char *dev, int baud)
{
  struct termios t;
  int fd = open(dev, O_RDWR | O_NOCTTY);

  if (fd < 0) {
    perror(dev);
    return -1;
  }
  if (tcgetattr(fd, &t) != 0) {
    perror("tcgetattr");
    close(fd);
    return -1;
  }
  cfmakeraw(&t);
  t.c_cflag |= CLOCAL | CREAD;
  t.c_cflag &= ~(CRTSCTS | CSTOPB | PARENB);
  t.c_cc[VMIN] = 1;
  t.c_cc[VTIME] = 0;
  cfsetispeed(&t, baud == 38400 ? B38400 : B9600);
  cfsetospeed(&t, baud == 38400 ? B38400 : B9600);
  if (tcsetattr(fd, TCSANOW, &t) != 0) {
    perror("tcsetattr");
    close(fd);
    return -1;
  }
  tcflush(fd, TCIOFLUSH);
  return fd;
}

/* macOS asks for Bluetooth access on behalf of the "responsible" app: the
 * terminal (or Mednafen, or whatever launched us), which may have no Bluetooth
 * usage description, and then the request is refused and we're killed. So
 * re-exec ourselves as our own responsible process; macOS then asks for
 * blesim, using the Info.plist embedded in this binary. (Private but
 * long-standing API, as used by Terminal and LLDB; --no-disclaim skips it.) */
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim)
    __attribute__((weak_import));
extern char **environ;

static void disclaim(char **argv)
{
  posix_spawnattr_t attr;
  pid_t pid;
  char path[1024];
  uint32_t size = sizeof path;

  if (getenv("BLESIM_DISCLAIMED") || !responsibility_spawnattrs_setdisclaim)
    return;
  setenv("BLESIM_DISCLAIMED", "1", 1);
  if (posix_spawnattr_init(&attr) != 0)
    return;
  posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETEXEC);
  responsibility_spawnattrs_setdisclaim(&attr, 1);
  if (_NSGetExecutablePath(path, &size) == 0)
    posix_spawn(&pid, path, NULL, &attr, argv, environ);
  /* Only returns on failure: carry on as we are. */
  posix_spawnattr_destroy(&attr);
}

/* A stable 4-hex-digit id for this Mac, so two simulators in a room differ. */
static unsigned short mac_id(void)
{
  char host[256] = "";
  unsigned h = 2166136261u;
  const char *p;

  gethostname(host, sizeof host);
  for (p = host; *p; p++)
    h = (h ^ (unsigned char)*p) * 16777619u;
  return (unsigned short)(h ^ h >> 16);
}

int main(int argc, char **argv)
{
  @autoreleasepool {
    static wg_config cfg;
    static wg g;
    static char serial_id[8];
    wg_ops ops;
    wgt_ops tops;
    int in_fd = STDIN_FILENO, out_fd = STDOUT_FILENO;
    const char *config = NULL, *serial = NULL, *logpath = NULL, *name = NULL;
    int baud = 9600, i;
    uint32_t last_byte = 0;

    for (i = 1; i < argc; i++)
      if (!strcmp(argv[i], "--no-disclaim"))
        break;
    if (i == argc)
      disclaim(argv);

    for (i = 1; i < argc; i++) {
      if (!strcmp(argv[i], "--config") && i + 1 < argc)         config = argv[++i];
      else if (!strcmp(argv[i], "--serial") && i + 1 < argc)    serial = argv[++i];
      else if (!strcmp(argv[i], "--baud") && i + 1 < argc)      baud = atoi(argv[++i]);
      else if (!strcmp(argv[i], "--log") && i + 1 < argc)       logpath = argv[++i];
      else if (!strcmp(argv[i], "--name") && i + 1 < argc)      name = argv[++i];
      else if (!strcmp(argv[i], "--quiet"))                     log_stderr = 0;
      else if (!strcmp(argv[i], "--phone-log") && i + 1 < argc) {
        const char *v = argv[++i];
        phone_log = !strcmp(v, "all") ? PL_ALL : !strcmp(v, "none") ? PL_NONE : PL_EVENTS;
      }
      /* Anything else is ignored: Mednafen passes a dummy argument. */
    }

    signal(SIGPIPE, SIG_IGN);
    console_thread = pthread_self();
    wg_config_defaults(&cfg);
    if (config && wg_posix_load_config(&cfg, config) != 0)
      return 1;
    if (logpath && !(logfile = fopen(logpath, "a")))
      perror(logpath);
    if (serial) {
      if ((in_fd = open_serial(serial, baud)) < 0)
        return 1;
      out_fd = in_fd;
    }

    snprintf(serial_id, sizeof serial_id, "%04X", mac_id());
    tops.ctx = NULL;
    tops.send = ble_send;
    tops.pump = ble_pump;
    tops.now_ms = ble_now;
    tops.log = ble_log;
    wgt_init(&tun, &tops, &cfg);
    tun.fw = "blesim 1";
    tun.serial = serial_id;
    tun.board = "mac";

    memset(&ops, 0, sizeof ops);
    ops.ctx = &out_fd;
    ops.tx = tx_fd;
    ops.log = wg_log;
    wgt_wg_ops(&tun, &ops);
    wg_init(&g, &ops, &cfg);

    inbox = [NSMutableArray new];
    cbq = dispatch_queue_create("wondergate.ble", DISPATCH_QUEUE_SERIAL);
    module = [Module new];
    module.outq = [NSMutableArray new];
    module.name = name ? @(name) : [NSString stringWithFormat:@"WonderGate-%s", serial_id];
    {
      static const char *const auth[] = { "not determined (macOS will ask)", "restricted", "denied", "allowed" };
      CBManagerAuthorization a = CBManager.authorization;
      blog("# ble: Bluetooth access %s", a <= CBManagerAuthorizationAllowedAlways ? auth[a] : "?");
    }
    module.pm = [[CBPeripheralManager alloc] initWithDelegate:module queue:cbq options:nil];

    blog("blesim up: %s, server %s, %d redirects, module %s", serial ? serial : "stdio", cfg.server,
         cfg.n_redirect, module.name.UTF8String);

    for (;;) {
      struct pollfd p = { in_fd, POLLIN, 0 };
      uint8_t buf[256];
      ssize_t n;
      int r = poll(&p, 1, LOOP_MS);

      if (r < 0 && errno == EINTR)
        continue;
      @autoreleasepool {
        wgt_poll(&tun);                          /* the phone's messages and link changes */
        if (r == 0) {
          if (g.rx_state != 0 && (int32_t)(ble_now(NULL) - last_byte) >= FRAME_GAP_MS)
            wg_rx_reset(&g);
          continue;
        }
        n = read(in_fd, buf, sizeof buf);
        if (n < 0 && errno == EINTR)
          continue;
        if (n <= 0)
          break;
        last_byte = ble_now(NULL);
        for (i = 0; i < n; i++)
          wg_rx(&g, buf[i]);
        wgt_adapter_state(&tun, g.status);
      }
    }

    blog("serial line closed, exiting");
    wg_reset(&g);
    wgt_adapter_state(&tun, g.status);
    dispatch_sync(cbq, ^{ [module.pm stopAdvertising]; });
    usleep(200000);                              /* let the last notifications go */
  }
  return 0;
}

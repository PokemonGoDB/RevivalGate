/* Mednafen - Multi-system Emulator
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 */

/* WonderSwan serial port emulation, ported from upstream comm.cpp, with an
 * optional in-process MobileWonderGate adapter (wgcore) on the other end.
 *
 * The adapter is enabled only when WG_ADAPTER_CONFIG names a config file
 * (WG_ADAPTER_LOG optionally names a trace log). WG_ADAPTER_TUNNEL=HOST:PORT
 * carries the adapter's sockets over the Bluetooth tunnel protocol on a TCP
 * stream to a phone stand-in (core/wg_tunnel_stream.h) instead of opening them
 * here; WG_ADAPTER_MTU sets that link's MTU (default 247). Otherwise behaviour matches
 * upstream with no link peer: transmitted bytes complete immediately and raise
 * the serial-send interrupt; nothing is ever received.
 *
 * With the adapter: each byte the console sends goes to wg_rx(), which may
 * block on the network (the emulator simply pauses). Adapter replies arrive
 * one byte per 9600-baud byte time (about 12 scanlines) while the port is
 * enabled. The port holds one received byte: if the game hasn't read the
 * previous one, the new byte is lost and the overrun flag (status bit 1) is
 * set until the game writes control bit 5. Final Lap 2000 depends on this:
 * it waits for "a byte arrived", ignores the rest of the reply, and expects it
 * gone. Disabling the port (control bit 7 = 0) resets the receiver: the held
 * byte is dropped and bytes arriving meanwhile are lost (Final Lap clears a
 * stale byte this way). Adapter state is not part of save states.
 *
 * Transmit-empty is a level-triggered interrupt here, as on hardware: it is
 * asserted whenever the port is enabled and nothing is waiting to be sent
 * (emu/build_core.sh adds it to interrupt.c's level mask). Upstream only
 * pulsed it after a send, which let GunPey EX's link-cable "0x8F" byte get
 * stuck until the first WonderGate byte and corrupt that frame. */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wswan.h"
#include "interrupt.h"
#include "comm.h"
#include "wg.h"
#include "wg_posix.h"
#include "wg_tunnel.h"
#include "wg_tunnel_stream.h"

#include "../state_inline.h"

static uint8 Control;
static uint8 SendBuf, RecvBuf;
static bool SendLatched, RecvLatched;

/* A real adapter drops a half-received frame after a pause; ~100 ms. */
#define FRAME_GAP_LINES 1200

static void send_irq_level(void)
{
   WSwan_InterruptAssert(WSINT_SERIAL_SEND, (Control & 0x80) && !SendLatched);
}

/* Scanlines per byte: 9600 baud ~ 960 B/s, ~12000 lines/s. */
#define LINES_PER_BYTE_9600  12
#define LINES_PER_BYTE_38400 3

static int      wg_on = -1;   /* -1 = not yet checked */
static wg       gate;
static wg_config gate_cfg;
static wg_posix gate_px;
static wg_ops   gate_ops;
static uint8    rxq[8192];
static unsigned rxq_head, rxq_tail;
static int      rx_wait;
static bool     Overrun;
static unsigned idle_lines;     /* since the console last sent a byte */
static int      raw_log;        /* WG_ADAPTER_RAW=1: log every byte both ways */
static unsigned long line_no;   /* scanlines since reset, for the raw log */
static int      tun_on;         /* sockets go through the tunnel */
static wgt      gate_tun;
static wgt_stream gate_st;
static wgt_ops  gate_tops;
static unsigned tun_lines;

/* Lines between looks at the tunnel's incoming messages (~50 ms). */
#define TUNNEL_POLL_LINES 600

static void px_log(void *ctx, const char *line)
{
   wg_posix_log(ctx, line);
}

static void raw(const char *dir, uint8 b)
{
   char msg[64];
   snprintf(msg, sizeof msg, "%s %02X  (line %lu, ctl %02X)", dir, b, line_no, Control);
   wg_posix_log(&gate_px, msg);
}

static void rx_push(void *ctx, const uint8_t *buf, size_t len)
{
   (void)ctx;
   while (len--)
   {
      unsigned next = (rxq_tail + 1) % sizeof rxq;
      if (next == rxq_head)
         return;                       /* full: drop, like an overrun */
      rxq[rxq_tail] = *buf++;
      rxq_tail = next;
   }
}

static void wg_setup(void)
{
   const char *conf = getenv("WG_ADAPTER_CONFIG");
   const char *logp = getenv("WG_ADAPTER_LOG");

   wg_on = 0;
   if (!conf || !*conf)
      return;
   wg_config_defaults(&gate_cfg);
   if (wg_posix_load_config(&gate_cfg, conf) != 0)
      return;
   memset(&gate_px, 0, sizeof gate_px);
   gate_px.tx = rx_push;
   if (logp && *logp)
      gate_px.logf = fopen(logp, "a");
   raw_log = getenv("WG_ADAPTER_RAW") && *getenv("WG_ADAPTER_RAW") == '1';
   wg_posix_ops(&gate_ops, &gate_px);
   if (getenv("WG_ADAPTER_TUNNEL") && *getenv("WG_ADAPTER_TUNNEL"))
   {
      const char *tun = getenv("WG_ADAPTER_TUNNEL");
      const char *mtu = getenv("WG_ADAPTER_MTU");

      if (wgt_stream_setup(&gate_st, &gate_tun, tun, (uint16_t)(mtu && *mtu ? atoi(mtu) : 247),
                           &gate_tops, px_log, &gate_px) != 0)
      {
         wg_posix_log(&gate_px, "WG_ADAPTER_TUNNEL wants HOST:PORT; adapter not attached");
         return;
      }
      wgt_init(&gate_tun, &gate_tops, &gate_cfg);
      gate_tun.fw = "wgcore-emu";
      gate_tun.board = "emulator";
      wgt_wg_ops(&gate_tun, &gate_ops);
      wgt_stream_connect(&gate_st);
      tun_on = 1;
   }
   wg_init(&gate, &gate_ops, &gate_cfg);
   wg_posix_log(&gate_px, tun_on ? "wgcore in emulator core: adapter attached to serial port, sockets through the tunnel"
                                 : "wgcore in emulator core: adapter attached to serial port");
   wg_on = 1;
}

void Comm_Reset(void)
{
   SendBuf = 0x00;
   RecvBuf = 0x00;

   SendLatched = false;
   RecvLatched = false;
   Overrun = false;

   Control = 0x00;

   if (wg_on < 0)
      wg_setup();
   if (wg_on > 0)
   {
      wg_reset(&gate);
      if (tun_on)
         wgt_adapter_state(&gate_tun, gate.status);
      rxq_head = rxq_tail = 0;
      rx_wait = 0;
   }

   WSwan_InterruptAssert(WSINT_SERIAL_RECV, RecvLatched);
   send_irq_level();
}

/* Called once per scanline from wsExecuteLine(). */
void Comm_Process(void)
{
   if(SendLatched && (Control & 0x80))
   {
      SendLatched = false;
      if (wg_on > 0)
      {
         if (raw_log)
            raw("tx", SendBuf);
         wg_rx(&gate, SendBuf);
         if (tun_on)
            wgt_adapter_state(&gate_tun, gate.status);
         idle_lines = 0;
      }
      send_irq_level();
   }

   if (wg_on > 0)
   {
      line_no++;
      if (tun_on && ++tun_lines >= TUNNEL_POLL_LINES)
      {
         tun_lines = 0;
         wgt_poll(&gate_tun);   /* the phone's messages, and reconnects */
      }
      /* Every gap, not just the first: the link peer allows one quiet spell. */
      if (++idle_lines % FRAME_GAP_LINES == 0 && gate.rx_state != 0)
         wg_rx_reset(&gate);
      if (rx_wait > 0)
         rx_wait--;
      else if (rxq_head != rxq_tail)
      {
         uint8 b = rxq[rxq_head];
         rxq_head = (rxq_head + 1) % sizeof rxq;
         if (!(Control & 0x80))
         {
            if (raw_log)
               raw("rx LOST (port off)", b);
         }
         else if (RecvLatched)
         {
            Overrun = true;          /* previous byte unread: this one is lost */
            if (raw_log)
               raw("rx LOST", b);
         }
         else
         {
            RecvBuf = b;
            RecvLatched = true;
            WSwan_InterruptAssert(WSINT_SERIAL_RECV, RecvLatched);
            if (raw_log)
               raw("rx", RecvBuf);
         }
         rx_wait = (Control & 0x40) ? LINES_PER_BYTE_38400 : LINES_PER_BYTE_9600;
      }
   }
}

uint8 Comm_Read(uint8 A)
{
   if(A == 0xB1)
   {
      RecvLatched = false;
      WSwan_InterruptAssert(WSINT_SERIAL_RECV, RecvLatched);

      return(RecvBuf);
   }
   else if(A == 0xB3)
   {
      uint8 ret = Control & 0xF0;

      if((Control & 0x80) && !SendLatched)
         ret |= 0x4;

      /* Bit 5 of the control port is "reset overrun", not a receive enable
       * (upstream gated on it; Tare Panda no GunPey enables with 0x80 only). */
      if((Control & 0x80) && RecvLatched)
         ret |= 0x1;

      if(Overrun)
         ret |= 0x2;

      return(ret);
   }

   return(0x00);
}

void Comm_Write(uint8 A, uint8 V)
{
   if(A == 0xB1)
   {
      if(Control & 0x80)
      {
         if (SendLatched && wg_on > 0 && raw_log)
            raw("OVERWRITE", SendBuf);
         SendBuf = V;
         SendLatched = true;
         send_irq_level();
      }
   }
   else if(A == 0xB3)
   {
      if (V & 0x20)
         Overrun = false;            /* bit 5 = reset overrun */
      if (!(V & 0x80) && RecvLatched)
      {
         RecvLatched = false;        /* port off: receiver reset */
         WSwan_InterruptAssert(WSINT_SERIAL_RECV, RecvLatched);
      }
      Control = V & 0xF0;
      send_irq_level();
   }
}

int Comm_StateAction(StateMem *sm, int load, int data_only)
{
   SFORMAT StateRegs[] =
   {
      SFVARN(SendBuf, "SendBuf"),
      SFVARN(RecvBuf, "RecvBuf"),

      SFVARN_BOOL(SendLatched, "SendLatched"),
      SFVARN_BOOL(RecvLatched, "RecvLatched"),

      SFVARN(Control, "Control"),
      { 0, 0, 0, 0 }
   };

   if(!MDFNSS_StateAction(sm, load, data_only, StateRegs, "COMM", false))
      return 0;

   if(load)
   {
      WSwan_InterruptAssert(WSINT_SERIAL_RECV, RecvLatched);
      send_irq_level();
   }

   return 1;
}

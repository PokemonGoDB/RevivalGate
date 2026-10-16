/*
 * mdfnkey: press keys in Mednafen (it must be frontmost: SDL ignores events
 * posted to a background process; tools/mdfn.sh brings it forward first).
 *
 *   mdfnkey key[:ms] [key[:ms] ...]
 *
 * Keys: x z enter esc up down left right f9 (snapshot to ~/.mednafen/snaps), or a
 * number (macOS virtual key code). Each key is held `ms` (default 120) so the
 * emulator sees it on at least a few frames, then released, with 150 ms between keys.
 * Build: cc -O2 -o mdfnkey mdfnkey.c -framework ApplicationServices
 */
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int code(const char *k)
{
  static const struct { const char *name; int code; } keys[] = {
    { "x", 7 }, { "z", 6 }, { "enter", 36 }, { "esc", 53 }, { "up", 126 },
    { "down", 125 }, { "left", 123 }, { "right", 124 }, { "f9", 101 },
  };
  size_t i;

  for (i = 0; i < sizeof keys / sizeof keys[0]; i++)
    if (!strcmp(k, keys[i].name))
      return keys[i].code;
  return atoi(k);
}

int main(int argc, char **argv)
{
  int i;

  if (argc < 2) {
    fprintf(stderr, "usage: %s key[:ms] ...\n", argv[0]);
    return 1;
  }
  for (i = 1; i < argc; i++) {
    char name[32];
    const char *colon = strchr(argv[i], ':');
    int ms = colon ? atoi(colon + 1) : 120;
    size_t n = colon ? (size_t)(colon - argv[i]) : strlen(argv[i]);
    CGEventRef ev;

    if (n >= sizeof name)
      n = sizeof name - 1;
    memcpy(name, argv[i], n);
    name[n] = '\0';

    ev = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)code(name), true);
    CGEventPost(kCGHIDEventTap, ev);
    CFRelease(ev);
    usleep((useconds_t)ms * 1000);
    ev = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)code(name), false);
    CGEventPost(kCGHIDEventTap, ev);
    CFRelease(ev);
    usleep(150 * 1000);
  }
  return 0;
}

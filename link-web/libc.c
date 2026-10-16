/*
 * The few C library functions wg.c calls, for a freestanding WebAssembly build (no libc in the browser).
 * vsnprintf covers wg.c's formats: %d %u %x %X %s %c %%, with a 0 flag, a width, and an l length.
 */
#include <stdarg.h>
#include <stddef.h>
#include "include/string.h"
#include "include/stdio.h"
#include "include/stdlib.h"
#include "include/ctype.h"

void *memcpy(void *dst, const void *src, size_t n)
{
  unsigned char *d = dst;
  const unsigned char *s = src;
  while (n--) *d++ = *s++;
  return dst;
}

void *memset(void *dst, int c, size_t n)
{
  unsigned char *d = dst;
  while (n--) *d++ = (unsigned char)c;
  return dst;
}

int memcmp(const void *a, const void *b, size_t n)
{
  const unsigned char *x = a, *y = b;
  for (; n; n--, x++, y++)
    if (*x != *y) return *x - *y;
  return 0;
}

size_t strlen(const char *s)
{
  const char *p = s;
  while (*p) p++;
  return (size_t)(p - s);
}

int strcmp(const char *a, const char *b)
{
  while (*a && *a == *b) a++, b++;
  return (unsigned char)*a - (unsigned char)*b;
}

char *strcpy(char *dst, const char *src)
{
  char *d = dst;
  while ((*d++ = *src++)) {}
  return dst;
}

int tolower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }

int atoi(const char *s)
{
  int n = 0, neg = 0;
  while (*s == ' ' || *s == '\t') s++;
  if (*s == '-' || *s == '+') neg = *s++ == '-';
  while (*s >= '0' && *s <= '9') n = n * 10 + (*s++ - '0');
  return neg ? -n : n;
}

typedef struct { char *buf; size_t size, len; } out_t;

static void put(out_t *o, char c)
{
  if (o->len + 1 < o->size) o->buf[o->len] = c;
  o->len++;
}

static void put_num(out_t *o, unsigned long v, int base, int upper, int neg, int width, int zero)
{
  char tmp[24];
  int n = 0;
  const char *digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
  do tmp[n++] = digits[v % (unsigned)base]; while ((v /= (unsigned)base) && n < (int)sizeof tmp);
  if (neg) width--;
  if (neg && zero) put(o, '-');
  for (; width > n; width--) put(o, zero ? '0' : ' ');
  if (neg && !zero) put(o, '-');
  while (n) put(o, tmp[--n]);
}

int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap)
{
  out_t o = { buf, size, 0 };
  for (; *fmt; fmt++) {
    int zero = 0, width = 0, lng = 0;
    if (*fmt != '%') { put(&o, *fmt); continue; }
    fmt++;
    if (*fmt == '0') zero = 1, fmt++;
    while (*fmt >= '0' && *fmt <= '9') width = width * 10 + (*fmt++ - '0');
    while (*fmt == 'l') lng = 1, fmt++;
    switch (*fmt) {
    case 'd': {
      long v = lng ? va_arg(ap, long) : va_arg(ap, int);
      put_num(&o, (unsigned long)(v < 0 ? -v : v), 10, 0, v < 0, width, zero);
      break;
    }
    case 'u': put_num(&o, lng ? va_arg(ap, unsigned long) : va_arg(ap, unsigned), 10, 0, 0, width, zero); break;
    case 'x': put_num(&o, lng ? va_arg(ap, unsigned long) : va_arg(ap, unsigned), 16, 0, 0, width, zero); break;
    case 'X': put_num(&o, lng ? va_arg(ap, unsigned long) : va_arg(ap, unsigned), 16, 1, 0, width, zero); break;
    case 'c': put(&o, (char)va_arg(ap, int)); break;
    case 's': {
      const char *s = va_arg(ap, const char *);
      int n = (int)strlen(s ? s : "(null)");
      for (; width > n; width--) put(&o, ' ');
      for (s = s ? s : "(null)"; *s; s++) put(&o, *s);
      break;
    }
    case '%': put(&o, '%'); break;
    case '\0': fmt--; break;
    default: put(&o, '%'); put(&o, *fmt); break;
    }
  }
  if (size) buf[o.len < size ? o.len : size - 1] = '\0';
  return (int)o.len;
}

int snprintf(char *buf, size_t size, const char *fmt, ...)
{
  va_list ap;
  int n;
  va_start(ap, fmt);
  n = vsnprintf(buf, size, fmt, ap);
  va_end(ap);
  return n;
}

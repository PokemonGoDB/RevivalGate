#ifndef LW_STDIO_H
#define LW_STDIO_H
#include <stdarg.h>
#include <stddef.h>
int snprintf(char *buf, size_t size, const char *fmt, ...);
int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap);
#endif

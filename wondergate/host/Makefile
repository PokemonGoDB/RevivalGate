CFLAGS ?= -O2 -g
CFLAGS += -std=c99 -D_DEFAULT_SOURCE -D_DARWIN_C_SOURCE -Wall -Wextra -I../core
CORE = ../core/wg.c ../core/wg_posix.c ../core/wg_tunnel.c ../core/wg_tunnel_stream.c
HDRS = ../core/wg.h ../core/wg_posix.h ../core/wg_tunnel.h ../core/wg_tunnel_stream.h

wgcore-host: main.c $(CORE) $(HDRS)
	$(CC) $(CFLAGS) -o $@ main.c $(CORE)

test: wgcore-host
	python3 -I ../tools/test_core.py ./wgcore-host
	python3 -I test_tunnel.py ./wgcore-host

clean:
	rm -f wgcore-host

.PHONY: test clean

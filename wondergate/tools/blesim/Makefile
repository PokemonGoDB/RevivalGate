# blesim: the Mac as a WonderGate Bluetooth module (wgcore + wg_tunnel + CoreBluetooth).
# Info.plist is embedded so macOS can ask for Bluetooth access (a bare tool would be killed).
CORE    = ../../core
CFLAGS ?= -O2 -g
CFLAGS += -Wall -Wextra -I$(CORE)
SRCS    = blesim.m $(CORE)/wg.c $(CORE)/wg_posix.c $(CORE)/wg_tunnel.c
HDRS    = $(CORE)/wg.h $(CORE)/wg_posix.h $(CORE)/wg_tunnel.h

blesim: $(SRCS) $(HDRS) Info.plist
	clang $(CFLAGS) -fobjc-arc -o $@ $(SRCS) -framework CoreBluetooth -framework Foundation \
	  -Wl,-sectcreate,__TEXT,__info_plist,Info.plist

clean:
	rm -rf blesim blesim.dSYM

.PHONY: clean

; SNAKE: a game for the MobileWonderGate cart's GAME menu.
;
; The cart stores a downloaded game (Content-Type: application/wondergate) in
; SRAM bank 7 behind a 16-byte "SWAN" header, copies it to SRAM bank 2 and
; jumps to 1000:0010 (cart ROM 0x1FFE1E..0x1FFE50). It does not return: the
; game owns the machine. START on the title screen restarts the cart.
;
; Build: python3 font.py && nasm -f bin -o snake.bin snake.asm
; Mono WonderSwan: SCR1 map at RAM 0x0800, 2bpp tiles at 0x2000.

        cpu 186
        bits 16
        org 0x10

MAP     equ 0x0800
TILEMEM equ 0x2000
T_BLANK equ 0
T_WALL  equ 1
T_BODY  equ 2
T_HEAD  equ 3
T_FOOD  equ 4
T_CHAR  equ 5                   ; tile of ASCII 0x20; up to 0x5F
DIGIT0  equ T_CHAR + 0x10
K_UP    equ 0x01                ; X1..X4
K_RIGHT equ 0x02
K_DOWN  equ 0x04
K_LEFT  equ 0x08
K_START equ 0x20
K_A     equ 0x40
SNAKEMAX equ 512                ; ring buffer size (power of two)

start:
        cli
        cld
        xor ax, ax
        out 0xB2, al            ; no interrupts: we poll
        mov ss, ax
        mov sp, MAP             ; stack below the map
        mov ax, cs
        mov ds, ax
        xor ax, ax
        mov es, ax              ; ES = console RAM

        out 0x00, al            ; display off while we set up
        mov al, 0x01
        out 0x07, al            ; SCR1 map at 0x0800
        xor al, al
        out 0x10, al            ; SCR1 scroll 0,0
        out 0x11, al
        out 0x01, al            ; back colour
        mov al, 0x20            ; shade pool: index 0 white .. 7 black
        out 0x1C, al
        mov al, 0x64
        out 0x1D, al
        mov al, 0xA8
        out 0x1E, al
        mov al, 0xFC
        out 0x1F, al
        mov al, 0x30            ; palette 0: colours 0,1 = shades 0,3
        out 0x20, al
        mov al, 0x75            ; colours 2,3 = shades 5,7
        out 0x21, al

        mov si, font            ; 1bpp font -> 2bpp tiles in colour 3
        mov di, TILEMEM
        mov cx, NTILES * 8
.tile:  lodsb
        stosb
        stosb
        loop .tile

        call cls
        mov al, 0x01
        out 0x00, al            ; SCR1 on
        out 0x14, al            ; LCD on
        mov word [hiscore], 0
        mov word [seed], 0x1234

; ---------------------------------------------------------------- title
title:
        call cls
        call border
        mov bx, 0x050B
        mov si, s_title
        call print
        mov bx, 0x0908
        mov si, s_press
        call print
        mov bx, 0x0B08
        mov si, s_exit
        call print
        mov bx, 0x0F06
        mov si, s_credit
        call print
        call wait_release
.wait:  call vsync
        inc word [seed]
        call keys
        test al, K_A
        jnz game
        test al, K_START
        jz .wait
        jmp 0xFFFF:0x0000       ; restart the cart

; ---------------------------------------------------------------- game
game:
        call cls
        call border
        mov bx, 0x0001
        mov si, s_score
        call print
        mov bx, 0x0013
        mov si, s_hi
        call print
        mov word [score], 0
        call show_score

        mov word [tail], 0
        mov word [head], 2
        mov byte [snake_y], 9
        mov byte [snake_y + 1], 9
        mov byte [snake_y + 2], 9
        mov byte [snake_x], 8
        mov byte [snake_x + 1], 9
        mov byte [snake_x + 2], 10
        mov bx, 0x0908
        mov ax, T_BODY
        call put
        inc bl
        call put
        inc bl
        mov ax, T_HEAD
        call put
        mov byte [dirx], 1
        mov byte [diry], 0
        mov byte [ndirx], 1
        mov byte [ndiry], 0
        mov byte [timer], 0
        mov byte [speed], 8
        call place_food

.loop:  call vsync
        call keys
        test al, K_START
        jz .nostart
        jmp title
.nostart:
        test al, K_UP
        jz .n1
        cmp byte [diry], 1
        je .n1
        mov word [ndirx], 0xFF00    ; ndirx = 0, ndiry = -1
.n1:    test al, K_DOWN
        jz .n2
        cmp byte [diry], 0xFF
        je .n2
        mov word [ndirx], 0x0100    ; ndirx = 0, ndiry = 1
.n2:    test al, K_LEFT
        jz .n3
        cmp byte [dirx], 1
        je .n3
        mov word [ndirx], 0x00FF    ; ndirx = -1, ndiry = 0
.n3:    test al, K_RIGHT
        jz .n4
        cmp byte [dirx], 0xFF
        je .n4
        mov word [ndirx], 0x0001    ; ndirx = 1, ndiry = 0
.n4:    inc byte [timer]
        mov al, [timer]
        cmp al, [speed]
        jb .loop
        mov byte [timer], 0
        mov ax, [ndirx]
        mov [dirx], ax

        mov si, [head]          ; new head position
        mov bl, [snake_x + si]
        mov bh, [snake_y + si]
        add bl, [dirx]
        add bh, [diry]
        call get
        cmp ax, T_FOOD
        je .eat
        cmp ax, T_BLANK
        jne over
        push bx                 ; move: erase the tail
        mov si, [tail]
        mov bl, [snake_x + si]
        mov bh, [snake_y + si]
        mov ax, T_BLANK
        call put
        inc si
        and si, SNAKEMAX - 1
        mov [tail], si
        pop bx
        jmp .advance
.eat:   inc word [score]
        call show_score
        mov ax, [score]         ; faster every 5 points, down to 3 frames
        mov cl, 5
        div cl
        cmp ah, 0
        jne .keep
        cmp byte [speed], 3
        jbe .keep
        dec byte [speed]
.keep:  push bx
        call place_food_avoid
        pop bx
.advance:
        push bx                 ; old head becomes body
        mov si, [head]
        mov bl, [snake_x + si]
        mov bh, [snake_y + si]
        mov ax, T_BODY
        call put
        pop bx
        inc si
        and si, SNAKEMAX - 1
        mov [head], si
        mov [snake_x + si], bl
        mov [snake_y + si], bh
        mov ax, T_HEAD
        call put
        jmp .loop

; ---------------------------------------------------------------- game over
over:
        mov ax, [score]
        cmp ax, [hiscore]
        jbe .nohi
        mov [hiscore], ax
        call show_score
.nohi:  mov bx, 0x080A
        mov si, s_over
        call print
        mov bx, 0x0A09
        mov si, s_again
        call print
        mov bx, 0x0B08
        mov si, s_menu
        call print
        call wait_release
.wait:  call vsync
        call keys
        test al, K_A
        jz .start
        jmp game
.start: test al, K_START
        jz .wait
        jmp title

; ---------------------------------------------------------------- helpers
place_food_avoid:               ; place food, leaving the new head cell (BX) free
        mov [avoid], bx
        jmp place_food.retry
place_food:
        mov word [avoid], 0
.retry: call rand
        xor dx, dx
        mov cx, 26
        div cx
        mov bl, dl
        inc bl                  ; x 1..26
        call rand
        xor dx, dx
        mov cx, 15
        div cx
        mov bh, dl
        add bh, 2               ; y 2..16
        cmp bx, [avoid]
        je .retry
        call get
        cmp ax, T_BLANK
        jne .retry
        mov ax, T_FOOD
        call put
        ret

show_score:
        push bx
        mov bx, 0x0007
        mov ax, [score]
        call num3
        mov bx, 0x0016
        mov ax, [hiscore]
        call num3
        pop bx
        ret

border:                         ; walls around rows 1..17, columns 0..27
        mov bx, 0x0100
.top:   mov ax, T_WALL
        call put
        mov bh, 17
        call put
        mov bh, 1
        inc bl
        cmp bl, 28
        jb .top
        mov bx, 0x0100
.side:  mov ax, T_WALL
        mov bl, 0
        call put
        mov bl, 27
        call put
        inc bh
        cmp bh, 18
        jb .side
        ret

cls:    push di
        push cx
        push ax
        mov di, MAP
        mov cx, 32 * 32
        xor ax, ax
        rep stosw
        pop ax
        pop cx
        pop di
        ret

cell:                           ; BL = x, BH = y -> DI = map entry
        push ax
        push bx
        mov al, bh
        xor ah, ah
        shl ax, 5
        xor bh, bh
        add ax, bx
        shl ax, 1
        add ax, MAP
        mov di, ax
        pop bx
        pop ax
        ret

put:    push di                 ; AX = tile at (BL, BH)
        call cell
        mov [es:di], ax
        pop di
        ret

get:    push di                 ; AX = tile at (BL, BH)
        call cell
        mov ax, [es:di]
        pop di
        ret

print:  push ax                 ; DS:SI = text (A-Z 0-9 space : - !), at (BL, BH)
.next:  lodsb
        or al, al
        jz .done
        sub al, 0x20
        xor ah, ah
        add ax, T_CHAR
        call put
        inc bl
        jmp .next
.done:  pop ax
        ret

num3:   push ax                 ; AX (0..999) as three digits at (BL, BH)
        push cx
        push dx
        xor dx, dx
        mov cx, 100
        div cx
        push dx
        add ax, DIGIT0
        call put
        inc bl
        pop ax
        mov cl, 10
        div cl
        push ax
        xor ah, ah
        add ax, DIGIT0
        call put
        inc bl
        pop ax
        mov al, ah
        xor ah, ah
        add ax, DIGIT0
        call put
        pop dx
        pop cx
        pop ax
        ret

vsync:  in al, 0x02             ; wait for the start of the next VBlank
        cmp al, 144
        jae vsync
.in:    in al, 0x02
        cmp al, 144
        jb .in
        ret

keys:   mov al, 0x20            ; -> AL: X1..X4 in bits 0-3, START 0x20, A 0x40, B 0x80
        out 0xB5, al
        times 8 nop
        in al, 0xB5
        and al, 0x0F
        mov ah, al
        mov al, 0x40
        out 0xB5, al
        times 8 nop
        in al, 0xB5
        and al, 0x0F
        shl al, 4
        or al, ah
        ret

wait_release:
.w:     call vsync
        call keys
        test al, K_A | K_START
        jnz .w
        ret

rand:   push dx                 ; AX = next pseudo-random number
        mov ax, [seed]
        mov dx, 25173
        mul dx
        add ax, 13849
        mov [seed], ax
        pop dx
        ret

s_title  db "S N A K E", 0
s_press  db "PRESS A: PLAY", 0
s_exit   db "START: EXIT", 0
s_credit db "WONDERGATE 2026", 0
s_score  db "SCORE", 0
s_hi     db "HI", 0
s_over   db "GAME OVER", 0
s_again  db "A: PLAY AGAIN", 0
s_menu   db "START: TITLE", 0

%include "font.inc"

        section .bss
seed     resw 1
score    resw 1
hiscore  resw 1
head     resw 1
tail     resw 1
avoid    resw 1
dirx     resb 1                 ; dirx/diry and ndirx/ndiry are read as words
diry     resb 1
ndirx    resb 1
ndiry    resb 1
timer    resb 1
speed    resb 1
snake_x  resb SNAKEMAX
snake_y  resb SNAKEMAX

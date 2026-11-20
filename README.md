# Live6Browser

Aplikasi kelas berbasis web untuk LAN: guru (admin) menayangkan **browser live** (apa yang ada di layar browser laptop guru) plus papan tulis sinkron (teks Markdown + gambar), siswa menonton dari HP. Terinspirasi dari [live6board](https://github.com/natedekaka/live6board), dengan fitur tambahan *live browser*.

## Fitur

- **Browser live**: guru memilih tab/jendela/layar via `getDisplayMedia`, frame JPEG dikirim ke siswa lewat WebSocket. Siswa read-only (zoom, wake lock).
- **Papan tulis sinkron**: blok teks (Markdown: judul, daftar, bold, kode, tabel) dan gambar, disinkronkan ke semua siswa.
- **Chat kelas**: guru ↔ siswa.
- **Ruang dengan kode 6 karakter**: siswa bergabung dengan kode + nama.
- **Tema gelap/terang**, tata letak 3 kolom (desktop) / tab (mobile).
- **Undangan QR**: modal QR untuk siswa.
- **Persistensi**: ruang & papan disimpan di `data/rooms/*.json`, gambar di `data/media/`.

## Persyaratan

- Node.js ≥ 18 (disarankan 20+).
- npm (registry reachable). Dependensi: `ws`, `qrcode-generator`.

## Instalasi

```bash
cd live6browser
npm install
cp .env.example .env   # opsional, sesuaikan kata sandi/port
```

## Menjalankan

```bash
./run.sh
# atau
npm start
```

Server berjalan pada dua port:

- Guru & Siswa : `http://localhost:9334` (atau `http://<IP-LAN>:9334`) — **satu port**

Log menampilkan IP LAN yang terdeteksi (mis. `192.168.8.16`).

## Alur guru

> Catatan: kedua form masuk (Guru & Siswa) ditampilkan di kedua port,
> sehingga pengguna bisa memilih peran langsung dari halaman masuk.


1. Buka **`http://localhost:9334`** di laptop guru (wajib `localhost` agar `getDisplayMedia` jalan — konteks aman).
2. Masukkan kata sandi (default `rahasinate`, dari `LIVE6BROWSER_TEACHER_PASSWORD`).
3. Kode ruang (6 karakter) muncul di bilah atas. Bagikan ke siswa via tombol **Undang** (QR + tautan) atau kode.
4. **Papan tulis**: tombol **+ Teks** (Markdown) dan **+ Gambar**.
5. **Browser live**: tombol **Bagikan** → pilih tab/jendela yang berisi materi. **Jangan pilih tab aplikasi Live6Browser itu sendiri** (akan rekursif). Hentikan dengan **Berhenti**.
   - Preset kualitas: **Hemat** (6 fps), **Standar** (9 fps), **Lancar** (12 fps).
6. Chat di kolom kanan.

## Alur siswa (HP)

1. Pastikan HP terhubung ke WiFi yang sama dengan laptop guru.
2. Buka browser HP: `http://<IP-LAN>:9334/?code=<KODE>` (atau scan QR).
3. Masukkan nama → masuk.
4. Tab **Browser** menampilkan tayangan live; tab **Papan** menampilkan papan tulis; tab **Chat** untuk bertanya.
5. Tampilan read-only. Wake Lock otomatis aktif agar layar tidak mati.

## Variabel lingkungan (`.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `LIVE6BROWSER_TEACHER_PASSWORD` | `rahasinate` | Kata sandi guru/admin |
| `LIVE6BROWSER_STUDENT_PASSWORD` | *(kosong)* | Kata sandi kelas siswa (opsional) |
| `LIVE6BROWSER_TEACHER_PORT` | `9334` | Port guru |
| `LIVE6BROWSER_STUDENT_PORT` | `9335` | (Tidak dipakai lagi — siswa memakai port guru) |
| `LIVE6BROWSER_HOST` | `0.0.0.0` | Alamat bind (0.0.0.0 = LAN) |
| `LIVE6BROWSER_TITLE` | `Live6Browser` | Judul tampilan |
| `LIVE6BROWSER_ROOM` | *(kosong)* | Kode ruang tetap (opsional) |
| `LIVE6BROWSER_DATA_DIR` | `./data` | Direktori data |
| `LIVE6BROWSER_SESSION_HOURS` | `12` | Masa berlaku sesi (jam) |
| `LIVE6BROWSER_MAX_UPLOAD_MB` | `12` | Batas unggah gambar (MB) |
| `LIVE6BROWSER_MAX_BLOCKS` | `400` | Maks blok papan |
| `LIVE6BROWSER_MAX_BLOCK_CHARS` | `8000` | Maks karakter per blok |
| `LIVE6BROWSER_MAX_IMAGE_PX` | `1920` | Lebar/tinggi maks gambar (px) |
| `LIVE6BROWSER_MAX_CHAT_CHARS` | `500` | Maks karakter pesan chat |
| `LIVE6BROWSER_MAX_STUDENTS` | `150` | Maks siswa per ruang |
| `LIVE6BROWSER_LOG_LEVEL` | `info` | Level log: debug/info/warn/error |

## Firewall (ufw)

`ufw` aktif di mesin ini. Agar HP bisa mengakses, buka port dari jaringan lokal:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 9334 proto tcp
sudo ufw allow from 10.0.0.0/8 to any port 9334 proto tcp
# atau, lebih longgar:
sudo ufw allow 9334/tcp
sudo ufw status
```

(Sudo memerlukan kata sandi — jalankan manual.)

## Catatan penting

- **Konteks aman**: `getDisplayMedia` hanya jalan di `http://localhost:9334` (atau HTTPS). Jika guru membuka `http://<IP-LAN>:9334`, aplikasi menampilkan banner dengan tautan `http://localhost:9334/?room=<KODE>` — buka tautan itu di laptop guru.
- **Jangan bagikan tab aplikasi Live6Browser** — pilih tab materi (PDF, slide, web). Berbagi tab aplikasi akan membuat loop.
- **Siswa read-only**: siswa tidak bisa mengubah papan tulis.
- **Persistensi**: ruang & papan disimpan otomatis ke `data/`. Hapus `data/` untuk reset.
- **Anti-throttling**: server mengirim sinyal `pull` sesuai fps agar browser tab latar tidak melambat.

## Struktur proyek

```
live6browser/
├── server.js
├── src/          (config, util, auth, rooms, static, http, ws)
├── public/       (login.html, app.html, css/, js/)
├── data/         (rooms/, media/, secret)  # dibuat saat runtime
├── run.sh
├── .env.example
└── README.md
```

## Lisensi

MIT.
EOF
echo "written"; wc -l README.md
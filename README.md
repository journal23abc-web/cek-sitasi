# Validator Sitasi Multi-Format

Alat bantu periksa format sitasi (in-text) & daftar referensi untuk naskah akademik —
berjalan 100% di browser, tanpa backend, cocok untuk hosting statis (GitHub Pages).

## Struktur proyek

```
index.html          Halaman utama — tempel/ketik teks, validasi langsung
upload.html         Upload file .docx, ekspor laporan PDF / docx ber-highlight
shared.css           Design tokens & komponen yang identik di kedua halaman
engine.js            Mesin inti: parsing referensi, deteksi gaya, validasi, matching
app.js                UI logic untuk index.html
upload.js             UI logic untuk upload.html (JSZip + Mammoth.js untuk baca .docx)
validator-worker.js  Web Worker — menjalankan validasi berat di background thread
tests/               Automated test suite (Node, tanpa dependency)
```

## Menjalankan tes

```
node tests/engine.test.js
```

Tidak perlu `npm install` — `engine.js` murni JavaScript tanpa dependency, tes memakai
modul `assert` bawaan Node. Exit code 1 kalau ada tes yang gagal (aman dipakai di CI).

## Gaya sitasi yang didukung

APA 7th Edition, MLA 9th Edition, Chicago (Author-Date), Harvard, IEEE, Vancouver.
Auto-detect gaya tersedia, tapi untuk dokumen ambigu selalu ada opsi pilih manual.

## Apa yang diperiksa

- Kecocokan sitasi di teks ↔ entri di daftar referensi (dan sebaliknya)
- Format pemisah penulis ("&" vs "and"), aturan "et al.", urutan alfabetis
- Duplikat referensi (DOI sama, judul sangat mirip)
- Tabrakan nama-belakang + tahun yang sama (mis. "H. Zhang, 2023" vs "F. Zhang, 2023") —
  dibedakan otomatis via inisial; kalau ambigu, ditandai jelas
- Gaya sitasi campuran dalam satu naskah (numerik + penulis-tahun tercampur)
- Rentang tahun referensi (deteksi referensi "usang" di luar rentang pilihan)
- Validitas DOI via CrossRef (opsional, butuh koneksi internet)
- Jenis sumber (buku/artikel/skripsi/dll) — supaya buku tidak dituntut punya DOI
- Format italic & sentence-case/title-case pada judul (khusus upload .docx, dibaca
  langsung dari XML asli file, bukan dari copy-paste)

## Keterbatasan yang jujur perlu diketahui

Ini **bukan** pemeriksa tata bahasa atau parser sitasi yang sempurna. Semua deteksi
berbasis **pola teks (heuristik)**, bukan parsing gaya-sitasi yang benar-benar formal:

- **Bukan pengganti proofreading manual.** Selalu periksa ulang hasil sebelum submit
  ke jurnal.
- **Deteksi nama internasional** (Unicode-aware) menangani aksen Latin (García,
  Łukasz) dan skrip non-Latin (Cyrillic, CJK, Arab) untuk normalisasi & pencocokan
  teks. Tapi heuristik "awal kata = nama baru" berbasis huruf kapital secara inheren
  kurang cocok untuk skrip tanpa konsep huruf besar/kecil (CJK, Arab) — nama yang
  ditulis dalam skrip aslinya (bukan diromanisasi) mungkin tidak selalu terdeteksi
  sebagai batas nama pengarang di sitasi naratif.
- **Duplikat & kemiripan judul** pakai kemiripan bigram — judul pendek (<25 karakter)
  sengaja tidak diperiksa untuk menghindari salah tuduh (satu kata beda pada judul
  pendek bisa tampak "mirip" padahal jelas beda topik).
- **Auto-detect gaya sitasi** memakai skor berbasis pola (tanda kutip, "pp.", dst.) —
  untuk dokumen yang formatnya sangat tidak konsisten, hasil deteksi bisa meleset;
  selalu tersedia opsi pilih gaya manual di dropdown.
- **DOI check** bergantung API publik CrossRef — hasil "tidak ditemukan" atau
  "metadata beda" bisa juga karena DOI belum terindeks CrossRef, bukan berarti DOI-nya
  salah (khususnya jurnal kecil/baru).
- **Copy-paste dari Word** ke kotak teks index.html cuma membawa teks polos (tanpa
  italic). Kalau butuh cek format italic yang akurat, gunakan halaman Upload —
  itu membaca format asli langsung dari file `.docx`.

## Privasi

Semua pemrosesan (parsing referensi, deteksi gaya, cek format) terjadi di browser
Anda sendiri — tidak ada data yang dikirim ke server manapun, kecuali saat Anda
sengaja mengaktifkan "Validasi DOI via CrossRef" (yang mengirim string DOI, bukan
seluruh naskah, ke api.crossref.org).

## Catatan teknis tambahan

- **Font**: memakai font sistem (`-apple-system`/`Segoe UI`/Roboto/dst.) untuk teks,
  dan `ui-monospace`/`SF Mono`/`Cascadia Code`/dst. untuk elemen kode — tidak ada
  dependency Google Fonts, jadi tidak ada request tambahan saat halaman dibuka.
- **Library eksternal** (JSZip, Mammoth.js di `upload.html`) dimuat dari jsDelivr
  dengan Subresource Integrity (`integrity="sha384-..."`) — browser akan menolak
  memuat file itu kalau isinya pernah berubah dari yang di-hash, jadi aman dari CDN
  yang di-kompromikan. Kalau versi library di-upgrade, hash SRI-nya harus dihitung
  ulang (`openssl dgst -sha384 -binary FILE | openssl base64 -A`).
- **Web Worker**: dokumen besar (>50rb karakter gabungan artikel+referensi) di
  `upload.html` otomatis diproses di background thread (`validator-worker.js`)
  supaya tab browser tidak macet, dengan fallback otomatis ke main thread kalau
  Worker gagal/timeout.
- **Aksesibilitas**: tab (baik input mode maupun kategori hasil) pakai pola ARIA
  tabs standar (`role="tab"`, `aria-selected`, navigasi panah kiri/kanan), status
  proses punya `aria-live="polite"` supaya terbaca screen reader, dan tombol
  ikon-saja (copy) punya `aria-label`.

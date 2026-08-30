# Validator Sitasi Multi-Format

Alat bantu periksa format sitasi (in-text) & daftar referensi untuk naskah akademik —
berjalan 100% di browser, tanpa backend, cocok untuk hosting statis (GitHub Pages).

## Struktur proyek

```
index.html             Beranda (hub "Journal Tools") — pilih mau pakai tool yang mana
validator-copy.html    Validator sitasi via copy-paste teks — tempel & validasi langsung
validator-upload.html  Validator sitasi via upload .docx — ekspor laporan PDF / docx ber-highlight
preliminary-check.html Preliminary check naskah (upload .docx) — dashboard IMRAD & checklist
link-upload.html       Tautkan sitasi in-text ke entri referensi (hyperlink internal) di .docx
citation-converter.html Konversi sitasi in-text (parenthetical & naratif) antar gaya, mis. APA7 → IEEE — tempel/upload .docx/isi manual, pratinjau, edit manual, ekspor .docx/.txt
shared.css              Design tokens, watermark & komponen yang identik di semua halaman
theme.js                 Toggle dark/light mode, dipakai semua halaman
engine.js                Mesin inti validator sitasi: parsing referensi, deteksi gaya, matching
docstats-engine.js       Mesin analisis struktur naskah (judul/abstrak/IMRAD) untuk Preliminary Check
link-engine.js            Mesin penautan sitasi <-> referensi untuk link-upload.html
converter-engine.js       Mesin konversi sitasi antar gaya — memakai ulang parsing & matching engine.js
app.js                    UI logic untuk validator-copy.html
upload.js                 UI logic untuk validator-upload.html (JSZip + Mammoth.js)
preliminary.js            UI logic untuk preliminary-check.html (JSZip)
link-upload.js            UI logic untuk link-upload.html (JSZip + Mammoth.js)
convert-ui.js             UI logic untuk citation-converter.html
validator-worker.js     Web Worker — menjalankan validasi berat di background thread
engine.test.js, docstats-engine.test.js, journal-rules-engine.test.js, converter-engine.test.js
                        Automated test suite (Node, tanpa dependency) — lihat catatan di bawah
```

`index.html` sengaja dibuat sesederhana mungkin (cuma kartu-kartu tautan) supaya gampang
ditambah kalau nanti ada tool baru — tinggal salin blok `.tool-card` yang ada dan ganti
tautan/isinya, tanpa perlu mengubah apa pun di halaman tool lainnya.

## Menjalankan tes

```
npm install
npm test
```

Kode aplikasi tetap berjalan langsung di browser tanpa proses build. Dependency development
`@xmldom/xmldom` hanya dipakai oleh tes Node yang memverifikasi mutasi OOXML/DOCX; mesin lain
tetap memakai modul `assert` bawaan Node. Exit code 1 kalau ada tes yang gagal (aman dipakai di CI).

## Gaya sitasi yang didukung

APA 7th Edition, MLA 9th Edition, Chicago (Author-Date), Harvard, IEEE, Vancouver.
Auto-detect gaya tersedia, tapi untuk dokumen ambigu selalu ada opsi pilih manual.

## Apa yang diperiksa

- Kecocokan sitasi di teks ↔ entri di daftar referensi (dan sebaliknya)
- Resolver terpusat untuk Validator, Converter, dan Tautkan Sitasi. Setiap keputusan membawa
  status, alasan, serta confidence; kemiripan fuzzy hanya menjadi bahan tinjauan dan tidak
  diterapkan otomatis dalam mode aman.
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
- **Peta Sitasi ↔ Referensi**: tampilan dua kolom (sitasi vs referensi) dengan status
  cocok/tidak cocok; entri yang cocok bisa **diklik untuk lompat & disorot** ke
  pasangannya di kolom sebelah
- **Penautan DOCX aman dan idempoten**: bookmark/hyperlink yang sudah benar dipakai ulang,
  nama/ID bookmark dicek agar tidak bertabrakan, teks terlihat tidak boleh berubah, dan struktur
  OOXML diperiksa sebelum file keluaran ditawarkan. Content-control Zotero/Mendeley/EndNote
  tetap dipertahankan; hyperlink disisipkan di dalam kontennya tanpa melepas metadata sitasi.

## Tingkat keyakinan pencocokan author-date

| Keputusan | Confidence | Perlakuan mode aman |
|---|---:|---|
| Nama personal/institusi sama persis | 100% | Diterapkan otomatis |
| Akronim yang diperkenalkan eksplisit | 98–99% | Diterapkan jika target unik |
| Akronim yang diturunkan dari nama institusi | 94% | Diterapkan jika target unik |
| Nama institusi dipendekkan hanya pada kualifier yurisdiksi | 90% | Diterapkan jika target unik |
| Kemiripan awalan/fuzzy | 55% | Tidak diterapkan; ditandai untuk tinjauan |
| Beberapa kandidat sama kuat | — | Abstain; pengguna harus mendisambiguasi |

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
  selalu tersedia opsi pilih gaya manual di dropdown. Sejak perbaikan terbaru, pola
  penulis terbalik APA/Harvard ("Nama, F.") secara aktif menurunkan skor IEEE/Vancouver
  (yang tidak pernah membalik nama) — ini mencegah skenario nyata yang sempat terjadi:
  naskah yang sitasinya sudah dikonversi ke IEEE tapi daftar referensinya masih format
  APA asli sempat terdeteksi sebagai IEEE dan membuat setiap referensi terparse rusak
  (mis. "Nama Belakang, F. M." terbaca jadi penulis "Nama Belakang" + judul "F. M.").
  Kalau keyakinan auto-detect rendah (di bawah ~60%), sebaiknya cek manual di dropdown
  gaya dan pastikan bagian teks & daftar referensi konsisten satu gaya yang sama.
- **Preliminary Check** mendeteksi judul/abstrak/struktur IMRAD berdasarkan pola heading
  umum (kata "Abstract"/"Introduction", penomoran bab, dst.) — naskah dengan format
  heading tidak lazim mungkin terlewat dan perlu dicek manual. Untuk heading generik yang
  rawan salah-tangkap (Introduction/Method/Results/Discussion/Conclusion), sistem hanya
  menerimanya kalau ada nomor bab ("3. Results") atau ditulis ALL CAPS ("RESULTS") — teks
  pendek yang kebetulan diawali kata itu (mis. judul kolom tabel) tidak ikut terhitung.
  Teks di dalam tabel juga dikeluarkan dari hitungan kata/kalimat naskah & deteksi heading
  sejak awal, supaya tidak tercampur dengan alur teks utama. Ambang batas di checklist
  (jumlah kata abstrak, jumlah referensi minimum, dst.) adalah **acuan umum yang sering
  dipakai**, bukan aturan baku semua jurnal terindeks Scopus — selalu rujuk panduan
  penulis (author guidelines) jurnal tujuan.
- **DOI check** bergantung API publik CrossRef — hasil "tidak ditemukan" atau
  "metadata beda" bisa juga karena DOI belum terindeks CrossRef, bukan berarti DOI-nya
  salah (khususnya jurnal kecil/baru).
- **Konversi Sitasi Antar Gaya** hanya mengubah sitasi in-text yang bisa dicocokkan
  dengan pasti ke satu entri di daftar referensi (memakai mesin pencocokan yang sama
  dengan Validator Sitasi) — sitasi ambigu atau tak dikenali dibiarkan seperti aslinya
  dan ditandai, bukan ditebak. Untuk daftar referensi, tool ini hanya menata ulang
  penomoran/urutan entri dan format nama penulis; bagian tahun, tanda kutip judul, dan
  detail bibliografi lain **sengaja tidak diubah**, karena penempatannya beda-beda per
  gaya dan gaya sumber seperti APA/IEEE/Vancouver biasanya cuma menyimpan inisial nama
  depan (bukan nama lengkap) — mengarang nama lengkap untuk gaya tujuan yang butuh itu
  (Chicago/MLA) berisiko salah, jadi tidak dilakukan. Untuk sitasi numerik ke IEEE, dua
  sitasi berurutan ditulis terpisah dengan koma ("[1], [2]"), bukan rentang tanda pisah —
  rentang ("[1]-[3]") hanya dipakai untuk 3 sitasi berurutan atau lebih, sesuai konvensi
  editorial IEEE yang sebenarnya.
- **Content-control pengelola sitasi** dipertahankan secara default saat auto-link. Hyperlink
  internal dibuat di dalam `w:sdtContent`; memperbarui sitasi dari Zotero/Mendeley/EndNote di
  kemudian hari dapat menulis ulang tampilan sitasi dan menghilangkan hyperlink tersebut, tetapi
  hubungan sitasi dengan pengelolanya tidak diputus oleh alat ini. Opsi kompatibilitas untuk
  membongkar wrapper tetap tersedia, namun bukan default.
- **Deteksi &amp; perbaikan gaya campuran** — kalau naskah sumbernya sendiri sudah bercampur
  gaya (mis. mayoritas APA tapi ada beberapa sitasi yang kadung ditulis format IEEE/numerik,
  atau sebaliknya), converter tidak cuma memproses sitasi bergaya sumber yang dipilih —
  ia juga memindai naskah untuk pola sitasi gaya LAIN dan mencoba mencocokkannya ke daftar
  referensi yang sama. Yang cocok ikut dikonversi otomatis; yang tidak, ditandai jelas
  dengan label "GAYA CAMPURAN" di daftar sitasi yang tidak diubah. Pemindaian ini sengaja
  dibuat konservatif untuk menghindari salah-tuduh: pola numerik hanya dicari dalam bentuk
  kurung siku `[12]` yang tidak ambigu (bukan `(12)` polos, yang gampang bentrok dengan
  angka statistik/tabel/persamaan biasa), dan pola author-page (mis. MLA) hanya dihitung
  kalau kata pertamanya benar-benar terlihat seperti nama orang (bukan "Tabel"/"Gambar" dst).
- **Parsing nama penulis dengan inisial bertanda hubung** (mis. "Yang, T.-J." untuk nama depan
  "Tien-Ju") sudah didukung sejak perbaikan terbaru — sebelumnya inisial semacam ini bisa
  keliru terbaca sebagai nama belakang yang terpisah (mis. "Yang" dan "T.-J." dianggap dua
  penulis berbeda). Ini memengaruhi Validator Sitasi (jumlah penulis, deteksi "et al.") dan
  Konversi Sitasi Antar Gaya (urutan nama, hitungan penulis) sekaligus, karena keduanya
  memakai parser penulis yang sama di `engine.js`.
- **Ekspor .docx "format asli dipertahankan"** (di Konversi Sitasi Antar Gaya) mengedit
  XML file .docx yang diunggah langsung di tempat teks sitasi berada, jadi heading/bold/
  italic/dst. di sekitarnya tidak tersentuh. Tapi ini SELALU dihitung ulang dari hasil
  konversi **otomatis** — kalau Anda mengedit manual di kotak teks hasil, edit itu tidak
  ikut ke file .docx ini (dipakai tombol ekspor .docx/.txt "teks polos" untuk itu, tapi
  formatnya jadi teks polos tanpa heading/bold/italic asli). Paragraf daftar referensi
  ikut **disusun ulang urutannya secara fisik** di dalam dokumen (bukan cuma teksnya)
  supaya penomoran berurut dari 1 sesuai urutan tampil — alfabetis untuk APA/Harvard/
  Chicago/MLA, urutan kemunculan sitasi pertama di teks untuk IEEE/Vancouver. Entri yang
  tidak ditemukan persis (verbatim) di teks aslinya (misalnya karena naskahnya diedit
  manual dulu di tab Isi Manual sebelum unggah, atau ada karakter tak biasa) tidak ikut
  dipindah — status setelah unduh akan menyebutkan berapa entri yang berhasil diurutkan
  ulang dari berapa total, supaya jelas kalau ada sisa yang perlu dicek manual.
- **Copy-paste dari Word** ke kotak teks validator-copy.html cuma membawa teks polos (tanpa
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
- **Library eksternal** (JSZip, Mammoth.js di `validator-upload.html`) dimuat dari jsDelivr
  dengan Subresource Integrity (`integrity="sha384-..."`) — browser akan menolak
  memuat file itu kalau isinya pernah berubah dari yang di-hash, jadi aman dari CDN
  yang di-kompromikan. Kalau versi library di-upgrade, hash SRI-nya harus dihitung
  ulang (`openssl dgst -sha384 -binary FILE | openssl base64 -A`).
- **Web Worker**: dokumen besar (>50rb karakter gabungan artikel+referensi) di
  `validator-upload.html` otomatis diproses di background thread (`validator-worker.js`)
  supaya tab browser tidak macet, dengan fallback otomatis ke main thread kalau
  Worker gagal/timeout.
- **CI**: workflow GitHub Actions menjalankan seluruh suite pada setiap push dan pull request.
  Suite mencakup resolver, konversi, mutasi OOXML, perlindungan content-control, serta uji
  idempotensi dua kali proses.
- **Aksesibilitas**: tab (baik input mode maupun kategori hasil) pakai pola ARIA
  tabs standar (`role="tab"`, `aria-selected`, navigasi panah kiri/kanan), status
  proses punya `aria-live="polite"` supaya terbaca screen reader, dan tombol
  ikon-saja (copy) punya `aria-label`.

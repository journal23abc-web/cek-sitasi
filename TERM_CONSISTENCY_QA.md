# QA — Konsistensi Istilah v3

## Perubahan utama

- Tidak ada lagi penggabungan konsep berdasarkan skor kemiripan. Skor hanya mengurutkan antrean review.
- Penggabungan non-akronim hanya terjadi setelah keputusan pengguna atau aturan kamus khusus.
- Review alias menyediakan pilihan istilah utama, `konsep berbeda`, `abaikan`, dan pembatalan keputusan.
- Keputusan review disimpan lokal berdasarkan fingerprint naskah dan dapat diekspor sebagai JSON.
- Perbedaan kapitalisasi biasa dan bentuk tunggal/jamak tidak lagi dianggap kesalahan yang perlu tindakan.
- Perbedaan tanda hubung/tanda baca tetap dilaporkan sebagai inkonsistensi ortografis.
- Istilah lowercase dapat ditemukan dari definisi, pengukuran, atau verba relasi eksplisit.
- Definisi komposisional seperti `comprises`, `consists of`, `includes`, `terdiri dari`, dan `meliputi` didukung.
- Bagian `References`, `Bibliography`, `Works Cited`, `Daftar Pustaka`, atau `Referensi` dikeluarkan dari analisis secara default.
- Label generik seperti `Appendix B`, `Model A`, dan `Table 3` tidak dipromosikan menjadi konsep.
- Analisis berat berjalan di Web Worker dengan fallback ke main thread.
- Upload dibatasi 25 MB dan diperiksa berdasarkan struktur paket, jumlah entry, ukuran ekstraksi, XML, serta panjang teks.
- Pembandingan kandidat alias memakai blocking, bukan seluruh pasangan konsep secara penuh.

## Hasil pengujian

- `term-consistency-engine.test.js`: 59 lulus, 0 gagal.
- Seluruh suite proyek: 346 lulus, 0 gagal.
- Integrasi Worker: lulus.
- Pemeriksaan sintaks engine, Worker, dan UI: lulus.
- Pemeriksaan ID elemen HTML terhadap JavaScript: tidak ada ID yang hilang.

## Uji pada naskah yang diberikan

Input: `Copyediting 1136 IJOTA.docx`.

- 6.260 kata diekstrak untuk pengujian.
- 35 konsep dipertahankan setelah filtering.
- Bagian referensi terdeteksi dan dikeluarkan.
- Noise `Appendix B`, `Model A`, `Model B`, `although`, dan `varies across contexts` tidak lagi muncul sebagai konsep.
- 0 variasi ortografis yang benar-benar perlu tindakan ditemukan; perbedaan kapitalisasi normal tidak lagi diberi peringatan palsu.
- 4 istilah dengan bukti variabel langsung tetapi tanpa definisi eksplisit tetap ditandai: `System Quality`, `Information Quality`, `Service Quality`, dan `Technology Characteristics`.
- Mesin hanya menilai 60 pasangan kandidat dari 595 kemungkinan pasangan.
- Waktu engine pada runtime QA sekitar 84 ms. Nilai di browser dapat berbeda menurut perangkat.

## Batasan yang tetap berlaku

- Ini mesin heuristik, bukan model semantic embedding. Sinonim bidang khusus yang tidak punya bukti tekstual bisa terlewat.
- Gunakan kamus khusus untuk terminologi disiplin, terjemahan lintas bahasa, atau nama konstruk yang sudah ditetapkan peneliti.
- Hubungan konsep berasal dari verba eksplisit dan tidak membuktikan kausalitas ilmiah.
- Keputusan akhir tentang apakah dua istilah benar-benar satu konsep tetap milik pengguna.

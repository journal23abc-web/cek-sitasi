# Cek Sitasi untuk Word

Add-in Microsoft Word untuk memeriksa sitasi dan daftar pustaka **APA 7** dan **IEEE**:

- **Validator** — deteksi otomatis dan saran perbaikan yang bisa diterima satu klik (ala Paperpal).
- **Tautan** — sitasi bisa diklik untuk melompat ke entri daftar pustakanya. Di Word 2016/2019 dibuat sebagai salinan tertaut memakai mesin "Tautkan Sitasi" versi web.
- **Metadata** — status DOI (CrossRef), Cari DOI, status Scopus, dan rentang tahun referensi.
- **Konversi** — APA 7 ⇄ IEEE dengan pratinjau.
- **Laporan** — hasil pemeriksaan dijadikan komentar Word + sorotan warna, langsung di dokumen atau di salinan.
- **Aman untuk Zotero/Mendeley/EndNote** — sitasi & daftar pustaka buatan pengelola sitasi hanya dilaporkan, tidak pernah ditulis ulang.

Situs & panduan pemasangan: https://journal23abc-web.github.io/word-cek-sitasi/
Demo tanpa Word: https://journal23abc-web.github.io/word-cek-sitasi/word-addin/demo.html

## Struktur repo

```
index.html                 halaman depan (unduh manifest, panduan pasang)
engine.js                  mesin sitasi (dari cek-sitasi)
bibliography-engine.js     model & format bibliografi (dari cek-sitasi)
converter-engine.js        konversi antar gaya (dari cek-sitasi)
link-engine.js             penautan .docx (dari cek-sitasi, tanpa perubahan)
scopus-engine.js           pencocokan Scopus (dari cek-sitasi, tanpa perubahan)
word-addin/                add-in Word — lihat word-addin/README.md
```

Semua file mesin harus tetap berada di akar repo; `word-addin/taskpane.html` memuatnya dari `../`.

## Tes

```
npm test
```

## Asal

Mesin pemeriksa berasal dari [journal23abc-web/cek-sitasi](https://github.com/journal23abc-web/cek-sitasi). Bila mesin di sana diperbarui, salin ulang `engine.js`, `bibliography-engine.js`, `converter-engine.js`, `link-engine.js`, dan `scopus-engine.js` ke repo ini. (Opsional: salin juga `scopus_sources.json` dan `scopus_proceedings.json` agar data Scopus dimuat dari repo ini sendiri.)

// i18n-translate.js — lapisan penerjemah OUTPUT validator (Indonesia -> Inggris), berbasis pola.
//
// Kenapa terpisah dari engine.js, bukan menulis ulang 32 titik pembuatan pesan di sana?
// Karena membongkar konstruksi string di 32 titik itu (banyak dengan interpolasi dinamis
// kompleks) berisiko tinggi memperkenalkan bug baru di logika VALIDASI inti yang sudah teruji
// menyeluruh. Modul ini murni MENERJEMAHKAN teks hasil akhir (title/description/correction)
// via pencocokan pola yang sudah dipetakan persis dari kode sumber — engine.js sendiri sama
// sekali tidak disentuh, jadi nol risiko terhadap logika deteksi/pencocokan sitasi.
//
// Cara pakai: translateIssue(issue, 'en') -> objek baru dengan title/description/correction
// berbahasa Inggris (field lain seperti code/severity/location tidak diubah). Kalau suatu pola
// tidak dikenali (pesan baru yang belum dipetakan), objek ASLI (Indonesia) dikembalikan apa
// adanya sebagai fallback aman — tidak pernah menampilkan hasil terjemahan yang rusak/kosong.
(function (global) {
  'use strict';

  function esc(s) { return String(s); }

  // Setiap entri: { test: RegExp yang dicocokkan ke title ASLI, translate: function(titleMatch, issue) -> {title, description, correction} }
  // Urutan penting: pola yang lebih SPESIFIK harus dicek SEBELUM pola yang lebih umum.
  var RULES = [
    // ---------- DOI checking (CrossRef) ----------
    {
      test: /^Tanpa DOI$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^"(.+)" tidak memiliki DOI yang terdeteksi\.$/);
        return { title: 'No DOI', description: dm ? '"' + dm[1] + '" has no detected DOI.' : issue.description };
      },
    },
    {
      test: /^DOI tidak dapat diverifikasi$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^DOI "(.+)" tidak dapat diverifikasi \((.+)\)\.$/);
        var reasonMap = { 'masalah jaringan': 'network issue' };
        return { title: 'DOI could not be verified', description: dm ? 'DOI "' + dm[1] + '" could not be verified (' + (reasonMap[dm[2]] || dm[2]) + ').' : issue.description };
      },
    },
    {
      test: /^DOI tidak ditemukan$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^DOI "(.+)" tidak ditemukan di CrossRef\. Mungkin salah ketik atau fiktif\.$/);
        return { title: 'DOI not found', description: dm ? 'DOI "' + dm[1] + '" was not found in CrossRef. It may be a typo or fabricated.' : issue.description };
      },
    },
    {
      test: /^DOI valid, metadata tidak sesuai$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^DOI ada, tetapi (.+) tidak cocok dengan data CrossRef\.(.*)$/);
        if (!dm) return issue;
        var fieldMap = { 'penulis': 'author', 'tahun': 'year', 'judul': 'title' };
        var body = dm[1].replace(/\b(penulis|tahun|judul)\b(?= \()/g, function (w) { return fieldMap[w] || w; })
          .replace(/referensi:/g, 'reference:').replace(/CrossRef:/g, 'CrossRef:');
        return { title: 'DOI valid, metadata mismatch', description: 'The DOI exists, but ' + body + ' does not match CrossRef data.' + (dm[2] || '') };
      },
    },
    {
      test: /^DOI valid & metadata sesuai$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^DOI "(.+)" terverifikasi di CrossRef\.$/);
        return { title: 'DOI valid & metadata matches', description: dm ? 'DOI "' + dm[1] + '" was verified against CrossRef.' : issue.description };
      },
    },
    // ---------- Numeric-family (IEEE/Vancouver) ----------
    {
      test: /^Nomor referensi tidak terdeteksi$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/\(([^)]+)\) untuk gaya (.+)\.$/);
        return {
          title: 'Reference number format not detected',
          description: 'The reference line does not start with a recognized numbering format (' + (dm ? dm[1] : '') + ') for ' + (dm ? dm[2] : '') + ' style.',
        };
      },
    },
    {
      test: /^Sitasi merujuk nomor yang tidak ada di referensi$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi "(.+)" merujuk \[(\d+)\] tetapi tidak ada referensi bernomor (\d+)\.$/);
        return {
          title: 'Citation refers to a non-existent reference number',
          description: dm ? 'Citation "' + dm[1] + '" refers to [' + dm[2] + '] but there is no reference numbered ' + dm[3] + '.' : issue.description,
        };
      },
    },
    {
      test: /^Penomoran referensi tidak berurutan$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Daftar referensi (.+) seharusnya/);
        return {
          title: 'Reference numbering is not sequential',
          description: 'The ' + (dm ? dm[1] : '') + ' reference list should be numbered sequentially 1, 2, 3, … with no gaps or duplicates.',
        };
      },
    },
    {
      test: /^Referensi tidak sesuai urutan kemunculan sitasi$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Pada (.+), referensi nomor 1.+Urutan kemunculan sitasi di teks saat ini: \[(.+)\]\.$/);
        return {
          title: 'Reference order does not match citation appearance order',
          description: 'In ' + (dm ? dm[1] : '') + ', reference number 1 must be the FIRST source cited in the text, number 2 the second source, and so on. Current order of citation appearance in the text: [' + (dm ? dm[2] : '') + '].',
        };
      },
    },
    {
      test: /^Referensi tidak pernah disitasi$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Referensi nomor (.+) \((.+)\) ada di daftar pustaka tapi tidak dirujuk di teks\.$/);
        return {
          title: 'Reference is never cited',
          description: dm ? 'Reference number ' + dm[1] + ' (' + dm[2] + ') is in the bibliography but is never cited in the text.' : issue.description,
        };
      },
    },
    // ---------- Author-date family ----------
    {
      test: /^Daftar penulis panjang$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Referensi "(.+)" memiliki (\d+) penulis\. Untuk (.+), umumnya cukup cantumkan (\d+) penulis pertama diikuti "et al\."$/);
        return {
          title: 'Long author list',
          description: dm ? 'Reference "' + dm[1] + '" has ' + dm[2] + ' authors. For ' + dm[3] + ', it is generally sufficient to list the first ' + dm[4] + ' authors followed by "et al."' : issue.description,
        };
      },
    },
    {
      test: /^Nama belakang & tahun sama, kemungkinan penulis sama$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^(\d+) referensi punya nama belakang dan tahun yang sama \((.+)\)\. Jika ini penulis yang sama dengan \d+ karya di tahun itu, beri akhiran huruf pada tahun \(di referensi maupun sitasi\): (.+)\.$/);
        return {
          title: 'Same surname & year, possibly the same author',
          description: dm ? dm[1] + ' references share the same surname and year (' + dm[2] + '). If these are the same author with ' + dm[1] + ' works that year, add a letter suffix to the year (in both the reference list and citations): ' + dm[3] + '.' : issue.description,
        };
      },
    },
    {
      test: /^Pemisah dua penulis salah$/,
      translate: function (m, issue) {
        if (/memakai "&" untuk dua penulis dalam kurung, bukan "and"\/"dan"/.test(issue.description)) {
          var dm2 = issue.description.match(/^Gaya (.+) memakai/);
          return { title: 'Wrong two-author separator', description: (dm2 ? dm2[1] : '') + ' style uses "&" for two authors inside parentheses, not "and"/"dan".' };
        }
        var dm = issue.description.match(/^Gaya (.+) memakai/);
        return { title: 'Wrong two-author separator', description: (dm ? dm[1] : '') + ' style uses "and" for two authors, not "&".' };
      },
    },
    {
      test: /^(\d+)\+ penulis tanpa "et al\."$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi menulis (\d+) nama, padahal (.+) mengharuskan "et al\." mulai (\d+) penulis\.$/);
        return {
          title: m[1] + '+ authors without "et al."',
          description: dm ? 'The citation names ' + dm[1] + ' authors, but ' + dm[2] + ' requires "et al." starting at ' + dm[3] + ' authors.' : issue.description,
        };
      },
    },
    {
      test: /^Multiple citations tidak alfabetis$/,
      translate: function () {
        return { title: 'Multiple citations not in alphabetical order', description: 'Several citations grouped in one set of parentheses must be sorted alphabetically by first author.' };
      },
    },
    {
      test: /^Sitasi naratif (\d+)\+ penulis tanpa "et al\."$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi naratif "(.+)" menulis (\d+) nama\.$/);
        return {
          title: 'Narrative citation with ' + m[1] + '+ authors, missing "et al."',
          description: dm ? 'Narrative citation "' + dm[1] + '" names ' + dm[2] + ' authors.' : issue.description,
        };
      },
    },
    {
      test: /^Sitasi tidak ada di daftar referensi$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi "(.+?)"(\s*\(bagian dari kelompok sitasi "(.+?)"\))? tidak memiliki entri cocok di daftar referensi\.$/);
        if (!dm) return issue;
        var groupNote = dm[3] ? ' (part of citation group "' + dm[3] + '")' : '';
        return { title: 'Citation not found in reference list', description: 'Citation "' + dm[1] + '"' + groupNote + ' has no matching entry in the reference list.' };
      },
    },
    {
      test: /^Kemungkinan ketidakcocokan$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi "(.+?)"(\s*\(bagian dari kelompok sitasi "(.+?)"\))? mungkin merujuk "(.+)"\.$/);
        if (!dm) return issue;
        var groupNote = dm[3] ? ' (part of citation group "' + dm[3] + '")' : '';
        return { title: 'Possible mismatch', description: 'Citation "' + dm[1] + '"' + groupNote + ' might refer to "' + dm[4] + '".' };
      },
    },
    {
      test: /^"et al\." untuk sumber hanya (\d+) penulis$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Referensi "(.+)" hanya punya (\d+) penulis tercatat, tidak perlu "et al\."$/);
        return {
          title: '"et al." used for a source with only ' + m[1] + ' author(s)',
          description: dm ? 'Reference "' + dm[1] + '" only has ' + dm[2] + ' recorded author(s) — "et al." is unnecessary.' : issue.description,
        };
      },
    },
    {
      test: /^Sitasi ambigu$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi "(.+)" bisa merujuk ke (\d+) referensi berbeda yang nama belakang & tahunnya sama \((.+)\)\. Tambahkan inisial pada sitasi untuk memperjelas\.$/);
        return {
          title: 'Ambiguous citation',
          description: dm ? 'Citation "' + dm[1] + '" could refer to ' + dm[2] + ' different references sharing the same surname & year (' + dm[3] + '). Add an initial to the citation to disambiguate.' : issue.description,
        };
      },
    },
    {
      test: /^Referensi tidak disitasi dalam teks$/,
      translate: function (m, issue) {
        var d1 = issue.description.match(/^"(.+)" ada di daftar referensi tapi tidak ada sitasi yang jelas merujuk ke sini \(perlu inisial untuk memastikan\)\.$/);
        if (d1) return { title: 'Reference not cited in the text', description: '"' + d1[1] + '" is in the reference list, but no citation clearly refers to it (an initial is needed to confirm).' };
        var d2 = issue.description.match(/^"(.+)" ada di daftar referensi tapi tidak disitasi\.$/);
        if (d2) return { title: 'Reference not cited in the text', description: '"' + d2[1] + '" is in the reference list but is never cited.' };
        var d3 = issue.description.match(/^"(.+)" ada di Works Cited tapi tidak disitasi \(dengan nomor halaman\) dalam teks\.$/);
        if (d3) return { title: 'Reference not cited in the text', description: '"' + d3[1] + '" is in the Works Cited list but is not cited (with a page number) in the text.' };
        return issue;
      },
    },
    {
      test: /^Singkatan institusi dipakai sebelum diperkenalkan lengkap$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi pertama untuk "(.+)" di teks langsung memakai singkatannya\./);
        return {
          title: 'Institutional abbreviation used before being introduced in full',
          description: (dm ? 'The first citation of "' + dm[1] + '" in the text uses the abbreviation directly. ' : '') + 'APA7 requires the FIRST occurrence to be written in full with the abbreviation in square brackets, after which later citations may use the abbreviation alone — though many journals do not strictly enforce this rule.',
        };
      },
    },
    {
      test: /^Nama belakang & tahun sama, penulis berbeda$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^(\d+) referensi punya nama belakang dan tahun yang sama \((.+)\) tapi tampaknya orang berbeda, dan belum semua sitasi ke sini menyertakan inisial pembeda\. Gunakan format "\((.+)\)" di setiap sitasi ke grup ini\.$/);
        return {
          title: 'Same surname & year, different authors',
          description: dm ? dm[1] + ' references share the same surname and year (' + dm[2] + ') but appear to be different people, and not every citation to them yet includes a disambiguating initial. Use the format "(' + dm[3] + ')" for every citation to this group.' : issue.description,
        };
      },
    },
    // ---------- MLA / author-page family ----------
    {
      test: /^MLA: 3\+ penulis tanpa "et al\."$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi "\((.+)\)" menulis (\d+) nama\. MLA memakai "et al\." mulai 3 penulis\.$/);
        return {
          title: 'MLA: 3+ authors without "et al."',
          description: dm ? 'Citation "(' + dm[1] + ')" names ' + dm[2] + ' authors. MLA uses "et al." starting at 3 authors.' : issue.description,
        };
      },
    },
    {
      test: /^Sitasi tidak ada di Works Cited$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Sitasi "\((.+)\)" tidak memiliki entri penulis cocok di Works Cited\.$/);
        return { title: 'Citation not found in Works Cited', description: dm ? 'Citation "(' + dm[1] + ')" has no matching author entry in Works Cited.' : issue.description };
      },
    },
    // ---------- Reference list ordering / duplicates ----------
    {
      test: /^Daftar referensi tidak alfabetis$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^(.+) mengharuskan daftar referensi/);
        return {
          title: 'Reference list is not alphabetical',
          description: (dm ? dm[1] : '') + ' requires the reference list to be sorted alphabetically by first author\u2019s surname (or institution name).',
        };
      },
    },
    {
      test: /^DOI duplikat$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^(\d+) referensi memakai DOI yang sama \((.+)\): (.+)\. Kemungkinan entri terduplikasi atau salah DOI\.$/);
        return {
          title: 'Duplicate DOI',
          description: dm ? dm[1] + ' references share the same DOI (' + dm[2] + '): ' + dm[3] + '. This may be a duplicated entry or an incorrect DOI.' : issue.description,
        };
      },
    },
    {
      test: /^Referensi kemungkinan duplikat$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Judul referensi "(.+)" dan "(.+)" sangat mirip \((\d+)% kemiripan\) — kemungkinan entri yang sama tertulis dua kali\.$/);
        return {
          title: 'Reference is possibly a duplicate',
          description: dm ? 'The reference titles "' + dm[1] + '" and "' + dm[2] + '" are very similar (' + dm[3] + '% similarity) — this may be the same entry written twice.' : issue.description,
        };
      },
    },
    {
      test: /^Tahun ambigu — penulis & tahun sama, judul berbeda$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^(\d+) referensi oleh "(.+)" tahun (.+) dengan judul berbeda\. Beri akhiran huruf: (.+)\.$/);
        return {
          title: 'Ambiguous year — same author & year, different titles',
          description: dm ? dm[1] + ' references by "' + dm[2] + '" in ' + dm[3] + ' with different titles. Add a letter suffix: ' + dm[4] + '.' : issue.description,
        };
      },
    },
    // ---------- Mixed citation style ----------
    {
      test: /^Gaya sitasi tidak konsisten$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Teks tampaknya mencampur beberapa bentuk sitasi berbeda: (.+)\. Pastikan hanya satu gaya yang dipakai di seluruh naskah\.$/);
        var body = dm ? dm[1]
          .replace(/nomor \[1\]/g, 'numeric [1]')
          .replace(/penulis-tahun "\(Smith, 2020\)"/g, 'author-date "(Smith, 2020)"')
          .replace(/penulis-halaman "\(Smith 45\)"/g, 'author-page "(Smith 45)"')
          : '';
        return {
          title: 'Inconsistent citation style',
          description: 'The text appears to mix several different citation forms: ' + body + '. Make sure only one style is used throughout the manuscript.',
        };
      },
    },
    // ---------- Reference metadata completeness ----------
    {
      test: /^Metadata referensi tampak tidak lengkap$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Referensi "(.+)" \(terdeteksi sebagai (.+)\) tampaknya belum mencantumkan: (.+)\. Periksa apakah ini genuinely hilang, atau cuma tidak terbaca sistem karena format penulisannya sedikit berbeda\.$/);
        if (!dm) return issue;
        var typeMap = { 'artikel jurnal': 'journal article', 'buku': 'book', 'bab buku': 'book chapter', 'skripsi/tesis/disertasi': 'thesis/dissertation', 'prosiding/konferensi': 'conference proceedings', 'situs web': 'website', 'laporan/working paper': 'report/working paper' };
        var fieldMap = { 'nama jurnal': 'journal name', 'nomor volume': 'volume number', 'halaman': 'pages', 'nomor artikel': 'article number', 'nama penerbit': 'publisher name', 'nama penerbit/institusi': 'publisher/institution name', 'nama penulis': 'author name', 'tahun terbit': 'publication year', 'judul': 'title', 'URL/tautan sumber': 'source URL/link', 'halaman atau nomor artikel': 'pages or article number' };
        var missingEn = dm[3].split(', ').map(function (f) { return fieldMap[f] || f; }).join(', ');
        return {
          title: 'Reference metadata appears incomplete',
          description: 'Reference "' + dm[1] + '" (detected as ' + (typeMap[dm[2]] || dm[2]) + ') appears to be missing: ' + missingEn + '. Check whether this is genuinely missing, or just not detected because of a slightly different formatting.',
        };
      },
    },
    {
      test: /^Referensi institusi hanya berupa singkatan$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^Entri referensi "(.+)" hanya berupa singkatan/);
        return {
          title: 'Institutional reference is abbreviation-only',
          description: 'The reference entry "' + (dm ? dm[1] : '') + '" is only an abbreviation I don\u2019t recognize, so readers may not know what it stands for. Consider writing out the full institution name. (For well-known abbreviations like OECD/WHO/IMF, this is usually fine and doesn\u2019t need changing.)',
        };
      },
    },
    // ---------- Malformed in-text citation formatting ----------
    {
      test: /^Sitasi tanpa spasi sebelum tanda kurung$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/antara "(.+)" dan "\("/);
        return { title: 'Citation missing space before parenthesis', description: 'No space before the citation\u2019s opening parenthesis — there should be a space between "' + (dm ? dm[1] : '') + '" and "(".' };
      },
    },
    {
      test: /^"et al\." format salah \(huruf besar\/kecil atau titik\)$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/^"(.+)" (.+) — seharusnya "et al\."\.$/);
        var problemsMap = {
          'huruf besar/kecil salah': 'has incorrect capitalization',
          'tanpa titik di akhir': 'is missing a period at the end',
          'huruf besar/kecil salah dan tanpa titik di akhir': 'has incorrect capitalization and is missing a period at the end',
        };
        return {
          title: '"et al." formatted incorrectly (capitalization or period)',
          description: dm ? '"' + dm[1] + '" ' + (problemsMap[dm[2]] || dm[2]) + ' — it should be "et al."' : issue.description,
        };
      },
    },
    {
      test: /^Tanda kurung sitasi tidak lengkap$/,
      translate: function () {
        return { title: 'Incomplete citation parentheses', description: 'A closing ")" was found with no matching opening "(" — the citation\u2019s opening parenthesis may be missing.' };
      },
    },
    {
      test: /^"et al\." mengikuti lebih dari satu nama penulis$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/bukan setelah (dua nama \((.+), (.+)\)|beberapa nama) disebutkan/);
        var who = dm ? (dm[1] === 'beberapa nama' ? 'several names' : 'two names (' + dm[2] + ', ' + dm[3] + ')') : 'more than one name';
        return { title: '"et al." follows more than one author name', description: '"et al." should immediately follow only the FIRST author, not appear after ' + who + '.' };
      },
    },
    {
      test: /^Tanda "&" tanpa spasi di sekitarnya$/,
      translate: function () {
        return { title: 'No space around "&"', description: 'No space around the "&" sign — there should be a space both before and after it.' };
      },
    },
    {
      test: /^Spasi berlebih di dalam tanda kurung sitasi$/,
      translate: function (m, issue) {
        if (/tepat setelah tanda kurung buka/.test(issue.description)) return { title: 'Extra space inside citation parentheses', description: 'There is extra space right after the opening parenthesis "(".' };
        return { title: 'Extra space inside citation parentheses', description: 'There is extra space right before the closing parenthesis ")".' };
      },
    },
    {
      test: /^Sitasi tanpa spasi setelah tanda kurung$/,
      translate: function (m, issue) {
        var dm = issue.description.match(/sebelum kata "(.+)\.\.\."/);
        return { title: 'Citation missing space after parenthesis', description: 'No space after the citation\u2019s closing parenthesis — there should be a space before the next word "' + (dm ? dm[1] : '') + '..."' };
      },
    },
    {
      test: /^Format sitasi bermasalah$/,
      translate: function (m, issue) { return { title: 'Citation formatting issue', description: issue.description }; },
    },
    // ---------- DOCX-format checks (italic / sentence-case / title-case) ----------
    {
      test: /^.*$/, // fallback catch-all handled last; see doDocxFormatFallback below
      skip: true,
    },
  ];

  // Pesan pemeriksaan format khusus .docx (italic/title-case/sentence-case) tidak punya title
  // tetap yang bisa dipetakan langsung (dibuat dinamis di sumbernya) — diterjemahkan lewat
  // pencocokan pada ISI deskripsinya sendiri, dicoba SETELAH semua RULES berbasis title gagal.
  var DOCX_FORMAT_RULES = [
    {
      test: /^Gaya Vancouver umumnya tidak memakai huruf miring sama sekali, tapi referensi ini terdeteksi sebagian huruf miring\.$/,
      translate: function () { return 'Vancouver style generally does not use italics at all, but this reference was detected with some italicized text.'; },
    },
    {
      test: /^Judul tampak memakai Title Case \("(.+)"\), gaya ini biasanya memakai sentence case\.$/,
      translate: function (m) { return 'The title appears to use Title Case ("' + m[1] + '"), but this style typically uses sentence case.'; },
    },
    {
      test: /^Nama jurnal "(.+)" seharusnya dicetak miring \(italic\), tapi tidak terdeteksi miring pada referensi ini\.$/,
      translate: function (m) { return 'The journal name "' + m[1] + '" should be italicized, but italics were not detected for this reference.'; },
    },
    {
      test: /^Judul artikel "(.+)" terdeteksi miring — untuk artikel jurnal, yang seharusnya miring adalah nama jurnalnya, bukan judul artikelnya\.$/,
      translate: function (m) { return 'The article title "' + m[1] + '" was detected as italicized — for a journal article, it\u2019s the journal name that should be italicized, not the article title.'; },
    },
    {
      test: /^Judul artikel tampak memakai Title Case \("(.+)"\), gaya ini mensyaratkan sentence case \(hanya kata pertama & nama diri yang kapital\)\.$/,
      translate: function (m) { return 'The article title appears to use Title Case ("' + m[1] + '"), but this style requires sentence case (only the first word & proper nouns capitalized).'; },
    },
    {
      test: /^Judul artikel tampak memakai sentence case \("(.+)"\), gaya ini mensyaratkan title case \(huruf besar di awal tiap kata penting\)\.$/,
      translate: function (m) { return 'The article title appears to use sentence case ("' + m[1] + '"), but this style requires title case (capitalize the first letter of each major word).'; },
    },
    {
      test: /^Judul buku "(.+)" seharusnya dicetak miring \(italic\), tapi tidak terdeteksi miring pada referensi ini\.$/,
      translate: function (m) { return 'The book title "' + m[1] + '" should be italicized, but italics were not detected for this reference.'; },
    },
    {
      test: /^Judul buku tampak memakai Title Case \("(.+)"\), gaya ini mensyaratkan sentence case\.$/,
      translate: function (m) { return 'The book title appears to use Title Case ("' + m[1] + '"), but this style requires sentence case.'; },
    },
    {
      test: /^Judul buku tampak memakai sentence case \("(.+)"\), gaya ini mensyaratkan title case\.$/,
      translate: function (m) { return 'The book title appears to use sentence case ("' + m[1] + '"), but this style requires title case.'; },
    },
    {
      test: /^Judul buku induk "(.+)" seharusnya dicetak miring \(italic\)\.$/,
      translate: function (m) { return 'The parent book title "' + m[1] + '" should be italicized.'; },
    },
    {
      test: /^Judul bab "(.+)" terdeteksi miring — yang seharusnya miring adalah judul buku induknya, bukan judul babnya\.$/,
      translate: function (m) { return 'The chapter title "' + m[1] + '" was detected as italicized — it\u2019s the parent book title that should be italicized, not the chapter title.'; },
    },
  ];

  var GENERIC_TITLE_TRANSLATIONS = {
    'Format .docx: italic/kapitalisasi': 'Word (.docx) format: italics/capitalization',
  };

  function translateIssue(issue, lang) {
    if (lang !== 'en' || !issue || !issue.title) return issue;
    for (var i = 0; i < RULES.length; i++) {
      var rule = RULES[i];
      if (rule.skip) continue;
      var m = issue.title.match(rule.test);
      if (m) {
        var translated;
        try { translated = rule.translate(m, issue); } catch (e) { translated = null; }
        if (translated && translated.title) {
          var out = {};
          for (var k in issue) out[k] = issue[k];
          out.title = translated.title;
          out.description = translated.description != null ? translated.description : issue.description;
          if (issue.correction) out.correction = translateCorrectionLabel(issue.correction);
          return out;
        }
      }
    }
    // DOCX format-checking issues: title itself is generic/dynamic — match on description body.
    for (var j = 0; j < DOCX_FORMAT_RULES.length; j++) {
      var dm = issue.description && issue.description.match(DOCX_FORMAT_RULES[j].test);
      if (dm) {
        var out2 = {};
        for (var k2 in issue) out2[k2] = issue[k2];
        out2.description = DOCX_FORMAT_RULES[j].translate(dm);
        out2.title = GENERIC_TITLE_TRANSLATIONS[issue.title] || issue.title;
        return out2;
      }
    }
    // Tidak ada pola yang cocok (pesan baru yang belum dipetakan) -> kembalikan APA ADANYA
    // (Indonesia) sebagai fallback aman, daripada menampilkan hasil terjemahan yang salah/kosong.
    return issue;
  }

  function translateCorrectionLabel(correction) {
    // "correction" fields are already just formatted citation/reference text (author names,
    // punctuation) — no natural-language words to translate, returned unchanged.
    return correction;
  }

  function translateIssueList(issues, lang) {
    if (lang !== 'en' || !issues) return issues;
    return issues.map(function (issue) { return translateIssue(issue, lang); });
  }

  var API = { translateIssue: translateIssue, translateIssueList: translateIssueList };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.I18nTranslate = API;
})(typeof window !== 'undefined' ? window : globalThis);

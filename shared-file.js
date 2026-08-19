// shared-file.js — jembatan berkas antar-halaman lewat IndexedDB.
//
// Tujuannya: sekali upload di halaman Beranda, semua tool berbasis-upload (Validasi Sitasi,
// Tautkan Sitasi, Preliminary Check, Konversi Sitasi, Cek Konsistensi Istilah) bisa langsung
// memakai berkas yang sama tanpa perlu upload ulang tiap pindah halaman.
//
// Kenapa IndexedDB, bukan localStorage/sessionStorage? Berkas .docx bisa beberapa MB — jauh di
// atas batas ukuran localStorage (~5-10MB, itu pun harus di-base64-kan dulu yang menambah ~33%
// ukurannya). IndexedDB mendukung Blob asli secara native, tanpa konversi, dan browser modern
// mengizinkan penyimpanan jauh lebih besar (biasanya ratusan MB+).
//
// Semua tetap 100% lokal di browser pengguna — tidak ada data yang terkirim ke server mana pun,
// sama seperti prinsip privasi yang sudah dipakai di seluruh proyek ini.
(function (global) {
  var DB_NAME = 'cek-sitasi-shared';
  var DB_VERSION = 1;
  var STORE_NAME = 'file';
  var KEY = 'current';
  // Berkas yang disimpan otomatis dianggap basi setelah durasi ini, supaya tidak diam-diam
  // memakai berkas naskah lama yang sudah tidak relevan kalau pengguna baru buka situsnya lagi
  // beberapa hari kemudian.
  var MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 jam

  function isSupported() {
    return typeof indexedDB !== 'undefined';
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!isSupported()) { reject(new Error('IndexedDB tidak didukung browser ini.')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // Menyimpan berkas (dan nama tool asal, buat ditampilkan di halaman lain sebagai konteks
  // "sebelumnya dipakai untuk X").
  function saveSharedFile(file, sourceLabel) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ blob: file, name: file.name, savedAt: Date.now(), sourceLabel: sourceLabel || null }, KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // Mengembalikan { file, name, savedAt, sourceLabel } atau null kalau tidak ada / sudah basi /
  // IndexedDB tidak tersedia (mis. mode private browsing di sebagian browser). Kegagalan APA PUN
  // di sini SELALU diperlakukan sebagai "tidak ada berkas tersimpan" (resolve ke null), tidak
  // pernah reject — supaya halaman pemanggil tidak perlu try/catch tambahan, cukup fallback ke
  // alur upload manual seperti biasa.
  function loadSharedFile() {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).get(KEY);
        req.onsuccess = function () {
          var entry = req.result;
          if (!entry) { resolve(null); return; }
          if (Date.now() - entry.savedAt > MAX_AGE_MS) { resolve(null); return; }
          var file;
          try {
            file = new File([entry.blob], entry.name, { type: entry.blob.type });
          } catch (e) {
            resolve(null); return; // browser lama tanpa dukungan konstruktor File dari Blob
          }
          resolve({ file: file, name: entry.name, savedAt: entry.savedAt, sourceLabel: entry.sourceLabel });
        };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function clearSharedFile() {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }

  global.SharedFile = {
    isSupported: isSupported,
    save: saveSharedFile,
    load: loadSharedFile,
    clear: clearSharedFile,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.SharedFile;
})(typeof window !== 'undefined' ? window : globalThis);

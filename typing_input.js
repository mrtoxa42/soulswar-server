'use strict';
// Match the client's English word input across Turkish keyboard layouts.
function normalizeLetter(key) {
    return key.replace(/[iıİ]/g, 'I').toUpperCase().replace(/[İŞĞÜÖÇ]/g, c=>({'İ':'I','Ş':'S','Ğ':'G','Ü':'U','Ö':'O','Ç':'C'})[c]);
}
function sameI(actual, expected) {
    return ['ı','i','I','İ'].includes(actual) && ['ı','i','I','İ'].includes(expected);
}
module.exports = {normalizeLetter, sameI};

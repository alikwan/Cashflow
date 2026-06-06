// البيت السعيد — formatters. Ported verbatim from
// design-reference/project/src/data.js (lines ~349-361). The bodies are PURE
// and copied byte-for-byte; only the module shape changed (named exports
// instead of fields on `window.DATA.fmt`).
//
// `USD_RATE` is the design-reference default (~1,350 د.ع/$). In production the
// live rate from `/api/meta` is passed into `fmtUSD(m, rate)`; when that rate
// is falsy `fmtUSD` falls back to this constant — same behavior as the source.
export const USD_RATE = 1350;          // متوسط سعر الصرف (د.ع/$) آخر 12 شهر

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
// مبلغ بالمليون → نص مناسب (مليار عند ≥ 1000)
export function fmtM(n, opts = {}) {
  const abs = Math.abs(n);
  if (abs >= 1000) return (n / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (opts.dec1 || abs < 10) return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return Math.round(n).toLocaleString('en-US');
}
export const unitM = (n) => Math.abs(n) >= 1000 ? 'مليار د.ع' : 'مليون د.ع';
// المبلغ الكامل بالدينار (للـ tooltips الدقيقة)
export const fmtFull = (n) => Math.round(n * 1e6).toLocaleString('en-US') + ' د.ع';
export const fmtUSD = (m, rate) => '$' + Math.round(m * 1e6 / (rate || USD_RATE)).toLocaleString('en-US');
export const fmtPct = (n, dec = 0) => (n * 100).toFixed(dec) + '%';

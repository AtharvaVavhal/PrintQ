function calculateCost({ pageCount, copies = 1, color = false, duplex = false }) {
  const BW_SINGLE    = parseInt(process.env.PRICE_BW_SINGLE    || '150', 10);
  const BW_DOUBLE    = parseInt(process.env.PRICE_BW_DOUBLE    || '100', 10);
  const COLOR_SINGLE = parseInt(process.env.PRICE_COLOR_SINGLE || '500', 10);
  const COLOR_DOUBLE = parseInt(process.env.PRICE_COLOR_DOUBLE || '400', 10);

  let ratePerSheet;
  if (color && duplex)       ratePerSheet = COLOR_DOUBLE;
  else if (color && !duplex) ratePerSheet = COLOR_SINGLE;
  else if (!color && duplex) ratePerSheet = BW_DOUBLE;
  else                       ratePerSheet = BW_SINGLE;

  const sheets = duplex ? Math.ceil(pageCount / 2) : pageCount;
  const totalPaise = sheets * copies * ratePerSheet;

  return {
    totalPaise,
    totalRupees: (totalPaise / 100).toFixed(2),
    breakdown: { pageCount, copies, color, duplex, sheets, ratePerSheet },
  };
}

module.exports = { calculateCost };
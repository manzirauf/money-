// Parses a mobile money SMS (MTN MoMo / Airtel / bank style) into a transaction.
// Formats vary: test with YOUR real messages and adjust the regexes below.
function localNow() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function parseSms(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const num = (s) => (s == null ? null : parseFloat(String(s).replace(/,/g, '')));

  let type = 'other';
  if (/withdraw/i.test(t)) type = 'withdrawn';
  else if (/you have received|have received|received .* from/i.test(t)) type = 'received';
  else if (/payment of|paid|you have sent|transferred|transfer of|sent/i.test(t)) type = 'sent';
  else if (/airtime|bundle|data/i.test(t)) type = 'paid';

  const amountM = t.match(/([\d,]+(?:\.\d+)?)\s*(?:RWF|FRW|Rwf)/i);
  const balanceM = t.match(/(?:new\s+)?balance\s*(?:is|:)?\s*([\d,]+(?:\.\d+)?)/i);
  const feeM = t.match(/fee(?:\s+was|\s+is|:)?\s*([\d,]+(?:\.\d+)?)/i);
  const dateM = t.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  const whoM = t.match(/(?:to|from)\s+([A-Za-z][A-Za-z .'-]*?)(?=\s+\d|\s+\(|\s+has|\s+at|\.|,|$)/);

  let category = type === 'received' ? 'Income' : 'Other';
  if (/airtime|bundle|data/i.test(t)) category = 'Data/Airtime';

  return {
    type,
    amount: amountM ? num(amountM[1]) : null,
    fee: feeM ? num(feeM[1]) : 0,
    balance: balanceM ? num(balanceM[1]) : null,
    date: dateM ? `${dateM[1]}T${dateM[2]}` : localNow(),
    dateFound: !!dateM,
    who: whoM ? whoM[1].trim() : '',
    category,
    raw: t,
  };
}

if (typeof module !== 'undefined') module.exports = { parseSms };
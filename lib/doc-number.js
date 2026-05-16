const supabase = require('./supabase');

async function nextDocNo(prefix) {
  const { data, error } = await supabase.rpc('increment_counter', { p_prefix: prefix });
  if (error) throw new Error(`Counter error for ${prefix}: ${error.message}`);
  return `${prefix}-${String(data).padStart(4, '0')}`;
}

module.exports = { nextDocNo };

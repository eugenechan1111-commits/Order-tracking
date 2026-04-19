const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase 未配置：请在 .env 中设置 SUPABASE_URL 和 SUPABASE_ANON_KEY');
    }
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  }
  return _client;
}

module.exports = new Proxy({}, {
  get(_, prop) {
    return (...args) => getClient()[prop](...args);
  }
});

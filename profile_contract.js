'use strict';
const schema = require('./profile_contract.json');
const racing = require('./notebook_racing.json');
function matches(value, rule) {
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (rule.required?.some((k) => !Object.hasOwn(value, k))) return false;
    if (rule.maxProperties !== undefined && Object.keys(value).length > rule.maxProperties)
      return false;
    for (const [key, v] of Object.entries(value)) {
      const child = rule.properties?.[key] || rule.values;
      if (!child && rule.additionalProperties === false) return false;
      if (child && !matches(v, child)) return false;
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(value) || (rule.maxItems !== undefined && value.length > rule.maxItems))
      return false;
    if (rule.items && value.some((v) => !matches(v, rule.items))) return false;
  } else if (rule.type === 'number' || rule.type === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (rule.type === 'integer' && !Number.isInteger(value))
    )
      return false;
    if (
      (rule.minimum !== undefined && value < rule.minimum) ||
      (rule.maximum !== undefined && value > rule.maximum)
    )
      return false;
  } else if (rule.type === 'boolean' && typeof value !== 'boolean') return false;
  else if (rule.type === 'string') {
    if (
      typeof value !== 'string' ||
      (rule.maxLength !== undefined && value.length > rule.maxLength)
    )
      return false;
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) return false;
  }
  return true;
}
function valid(value) {
  if (!matches(value, schema)) return false;
  const r = value.quests?.racing;
  if (r) {
    if (r.wins > r.podiums || r.podiums > r.races) return false;
    for (const [category, options] of Object.entries(racing.catalog)) {
      const item = options.find((o) => o.id === r.look[category]);
      if (
        !item ||
        r.medals < (item.medals || 0) ||
        r.races < (item.races || 0) ||
        r.wins < (item.wins || 0)
      )
        return false;
    }
  }
  return true;
}
module.exports = { valid, matches };

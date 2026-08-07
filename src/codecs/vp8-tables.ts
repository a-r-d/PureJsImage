const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeBase64 = (encoded: string): Uint8Array => {
  const output = new Uint8Array(Math.floor((encoded.length * 3) / 4))
  let accumulator = 0
  let bits = 0
  let offset = 0
  for (const character of encoded) {
    if (character === '=') break
    const value = base64Alphabet.indexOf(character)
    if (value < 0) continue
    accumulator = accumulator * 64 + value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output[offset] = (accumulator >>> bits) & 255
      offset += 1
      accumulator &= (1 << bits) - 1
    }
  }
  return output.subarray(0, offset)
}

export const keyframeBlockModeProbabilities = decodeBase64(
  '53gwWXNxeJhwmLNAfqp2LkZfr0WPUFVSSJtnODoKq9q9EQ2YkEcKJqvVkCIachoRoyzDFQqteRhQwxo+LEBVqi43E4igIc5HPxQI' +
    'cnLQDAniUSgLYLZUHRAkhrdZiWJlaqWUSLtkgp1vIEtQQmanY0o+KOqAKTUJsvGNGghraE8MG9n/VxEHSisakkmmMRedQSZpoDM0' +
    'H3OAV0RHLHIzD7oXLykObra3FRHCQi0ZZsW9FxIWWFiTliouLcTNK2G3dVUmI7M9JzXIVxoVK+irOCIzaHJmHV1NazYgGjMBUSsf' +
    'JxxVqzqlWmJAIhZ0zhciK6ZJRBlqFkCrJOFyIhMVZoS8EEx8PhJOX1U5MjAzwWUjn9dvWS5vPJQfrNvkFRJvcHFNVbP/JnhyKCoB' +
    'xPXRChltZFAIK5oBMxpHWCsdjKbVJSuaPT8em0MtRAHRjk5OEP+AIsWrKSgFZtO3BAHdMzIRqNHAFxlSfWIqWGhVda9SX1Q1WYBk' +
    'cWUtS097LzOAUasBOREFR2Y5NSkxcxUCCmb/phcGJiENeTlJGgFVKQpDik1uWi9yZR0QClWAZcQaORIKZmbVIhQrdRQPJKOARAEa' +
    'ih8kqxumJizlQ1c6qVJzGjuzPztatDumXUmaKCgVdI/RIievOS4WGIABNhElLw8QtyLfMS23LhEhtwZiDyC3QSBJcxyAF4DNKAMJ' +
    'czPAEgbfVyUJcztNQBUvaDcs2gk2NYLiQFpGzSgpFxo5NjlwuAUpJqbVHiIahZh0CiCGSyAMM8D/oCszJxM13RpyIEn/HwlB6gIP' +
    'AXZJWB8jQ2ZVN7pVOBUXbzvNLSXANyZGfElmASJiZj1HJSI1H/PARTxHJkl3HN4lRC2AIgEvC/WrPhETRpJVNz5GSw8JCUD/uHcQ' +
    'JSslmmSjVaABPwlciBxAIMlVVgYcBUD/GfgBOAgRhIn/N3SAOg8UUoc5GnkopDIfiZqFGSPaM2csg4N7HwaeVihAh5TgLbeAFhoR' +
    'g/CaDgHRUwwNNsD/RC8cLRAVW0DeBwHFOBUnmzyKF2bVVRpVVYCAIJKrEgsHP5CrBAT2IxsKkq6rDBqAvlAjY7RQfjYtVX4vV7Az' +
    'KRQgZUuAi3aSdIBVOCkPsOxVJQk+kiQTHqv/YRsURx4Rd3b/ERKKZSY8ijdGKxqOii09PtsBUbxAICkUdZeOFBWjcBMMPcOAMAQY',
)

export const coefficientUpdateProbabilities = decodeBase64(
  '////////////////////////////////////////////sPb////////////f8fz///////////n9/f////////////T8////////' +
    '///q/v7///////////3///////////////b+///////////v/f7///////////7//v////////////j+///////////7//7/////' +
    '//////////////////////3+///////////7/v7///////////7//v////////////79//7////////6//7//v////////7/////' +
    '////////////////////////////////////////////////////2f/////////////h/PH9///+/////+r68fr9//3+//////7/' +
    '///////////f/v7//////////+79/v7///////////j+///////////5/v////////////////////////////3////////////3' +
    '/v////////////////////////////3+///////////8//////////////////////////////7+///////////9////////////' +
    '//////////////////79///////////6//////////////7/////////////////////////////////////////////////////' +
    '////uvv6///////////q+/T+//////////v78/3+//7///////3+///////////s/f7///////////v9/f7+//////////7+////' +
    '///////+/v7///////////////////////////7////////////+/v////////////7////////////////////////////+////' +
    '////////////////////////////////////////////////////////////////////////////////////////////////////' +
    '////////////////////////////////////////////////////////+P/////////////6/vz+//////////j++f3/////////' +
    '//39///////////2/f3///////////z++/7+//////////78///////////4/v3///////////3//v7///////////v+////////' +
    '///1+/7///////////39/v////////////v9///////////8/f7////////////+//////////////z////////////5//7/////' +
    '/////////v/////////////9///////////6///////////////////////////////////////////+////////////////////' +
    '////////',
)

export const defaultCoefficientProbabilities = decodeBase64(
  'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/Yj+/+TbgICAgIC9gfL/49X/24CAgGp+4/zW0f//gICAAWL4/+zi//+A' +
    'gIC1he7+3er/moCAgE6GyvfGtP/bgICAAbn5//P/gICAgIC4lvf/7OCAgICAgE1u2P/s5oCAgICAAWX7//H/gICAgICqi/H87NH/' +
    '/4CAgCV0xPPk////gICAAcz+//X/gICAgIDPoPr/7oCAgICAgGZn5//Tq4CAgICAAZj8//D/gICAgICxh/P/6uGAgICAgFCB0//C' +
    '4ICAgICAAQH/gICAgICAgID2Af+AgICAgICAgP+AgICAgICAgICAxiPt38G7oqCRmz6DLcbdrLDcnfzdAUQvktCVp92i/9+AAZXx' +
    '/93g//+AgIC4jer93tz/x4CAgFFjtfKwvvnK//+AAYHo/dbF8sT//4BjedL6ycb/yoCAgBdbo/Kqu/fS//+AAcj2/+r/gICAgIBt' +
    'svH/5/X//4CAgCyCyf3NwP//gICAAYTv+9vR/6WAgIBeiOH72r7//4CAgBZkrvW6of/HgICAAbb5/+jrgICAgIB8j/H/4+qAgICA' +
    'gCNNtfvB0//NgICAAZ33/+zn//+AgIB5jev/4eP//4CAgC1jvPvD2f/ggICAAQH7/9X/gICAgIDLAfj//4CAgICAgIkBsf/g/4CA' +
    'gICA/Qn4+8/Q/8CAgICvDeDzwbn5xv//gEkRq92hs+yn/+qAAV/3/dS3//+AgIDvWvT609H//4CAgJtNw/i8w///gICAARjv+9rb' +
    '/82AgIDJM9v/xLqAgICAgEUuvu/J2v/kgICAAb/7//+AgICAgIDfpfn/1f+AgICAgI18+P//gICAgICAARD4//+AgICAgIC+JOb/' +
    '7P+AgICAgJUB/4CAgICAgICAAeL/gICAgICAgID3wP+AgICAgICAgPCA/4CAgICAgICAAYb8//+AgICAgIDVPvr//4CAgICAgDdd' +
    '/4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAyhjV67q/3KDwr/9+Jrboqbjkrv+7gD0uituXsvCq/9iA' +
    'AXDm+se/95///4CmbeT809f/roCAgCdNouistPWy//+AATTc9sbH+dz//4B8Sr/zt8H63f//gBhHgtuaqvO2//+AAbbh+dvw/+CA' +
    'gICVluL82M3/q4CAgBxsqvK3wv7f//+AAVHm/MzL/8CAgIB7ZtH3vMT/6YCAgBRfmfOkrf/LgICAAd74/9jVgICAgICor/b8683/' +
    '/4CAgC901//T1P//gICAAXns/dTW//+AgICNVNX8ycr/24CAgCpQoPCiuf/NgICAAQH/gICAgICAgID0Af+AgICAgICAgO4B/4CA' +
    'gICAgICA',
)

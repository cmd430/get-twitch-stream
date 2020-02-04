const https = require('https')
const { escape } = require('querystring')

const channel = 'smoodie'

function getAuth () {
  return new Promise((resolve, reject) => {
    https.request({
      hostname: 'api.twitch.tv',
      port: 443,
      path: `/api/channels/${channel}/access_token`,
      method: 'GET',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
      }
    }, res => {
      if (res.statusCode === 200) {
        let data = ''
        res.on('data', d => {
          data += d
        })
        res.on('end', () => {
          return resolve(JSON.parse(data))
        })
      } else {
        reject({
          code: res.statusCode,
          message: 'invaild status code'
        })
      }
    })
    .on('error', e => {
      return reject(e)
    })
    .end()
  })
}

function getStreamManifest (auth) {
  return new Promise((resolve, reject) => {
    https.request({
      hostname: 'usher.ttvnw.net',
      port: 443,
      path: `/api/channel/hls/${channel}.m3u8?allow_source=true&allow_audio_only=true&allow_spectre=false&sig=${auth.sig}&token=${escape(auth.token)}`,
      method: 'GET',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
      }
    }, res => {
      if (res.statusCode === 200) {
        let data = ''
        res.on('data', d => {
          data += d
        })
        res.on('end', () => {
          return resolve(data.toString())
        })
      } else {
        reject({
          code: res.statusCode,
          message: 'invaild status code'
        })
      }
    })
    .on('error', e => {
      return reject(e)
    })
    .end()
  })
}

// Convert 'Key=Value' to { key: value }
function getKeyValuePairs (data) {
  let properties = data.split(':')[1].split(',')
  let keyVals = {}
  properties.forEach((property, index) => {
    let keyVal = property.replace(/\"/g, '').split('=')
    if (keyVal[1] !== undefined) {
      keyVals[keyVal[0].replace(/\-/g, '_').toLowerCase()] = normailzeValue(keyVal[1])
    } else {
      let _key = Object.keys(keyVals)[index-1]
      keyVals[_key] = normailzeValue(`${keyVals[_key]},${keyVal[0]}`)
    }
  })

  if (keyVals.hasOwnProperty('type')) {
    if (keyVals.name === 'audio_only') {
      keyVals.type = 'AUDIO'
    }
  } else if (keyVals.hasOwnProperty('video')) {
    if (keyVals.video === 'audio_only') {
      delete keyVals.video
    }
  }
  return keyVals
}

function normailzeValue (value) {
  if (typeof(value) === 'string') {
    // Boolen
    switch (value.toLowerCase().trim()) {
      case 'true':
      case 'yes':
        return true
      case 'false':
      case 'no':
        return false
    }
    // Number
    if (/^\d+\.\d+$|^\d+$/.test(value)) {
      return parseFloat(value)
    }
  }
  // String or Already Correct Type
  return value
}

function parseStreamManifest (m3u8) {
  return new Promise((resolve, reject) => {
    let parsed = {
      twitch_info: {},
      streams: []
    }
    let meta = {
      media: {},
      stream_info: {},
      url: null
    }
    m3u8.split(/[\r\n]/).forEach((data, index) => {
      if (data !== '#EXTM3U') {
        if (data.startsWith('#EXT-X-TWITCH-INFO')) {
          parsed.twitch_info = getKeyValuePairs(data)
        } else {
          switch(index % 3) {
            case 2:
              // X-MEDIA
              meta.media = getKeyValuePairs(data)
              break;
            case 0:
              // X-STREAM
              meta.stream_info = getKeyValuePairs(data)
              break;
            case 1:
              // M3U8 URL
              meta.url = data
              parsed.streams.push(meta)
              meta = {
                media: {},
                stream_info: {},
                url: null
              }
          }
        }
      }
    })
    return resolve(parsed)
  })
}


/**
 * Get a Twitch Stream m3u8 file for use with ffmpeg to download
 * @param {Object} opts Settings for returned stream
 * @param {String} opts.channel Channel name as taken from twitch url
 * @param {Boolen} [opts.audio_only=false] When true will download ONLY stream audio
 *
 * Example Usage
 *  getStream({
 *  channel: 'TwitchUser',
 *    audio_only: false
 *  })
 *  .then(console.log)
 *
 */
function getStream(opts = {
  channel: null,
  audio_only: false
}) {
  return new Promise((resolve, reject) => {
    if (opts.channel === null) {
      return reject('opts.channel must be set')
    }

    return getAuth()
    .then(getStreamManifest)
    .then(parseStreamManifest)
    .then(m3u8 => {
      if (opts.audio_only) {
        return resolve(m3u8.streams[m3u8.streams.length - 1]) // Audio
      } else {
        return resolve(m3u8.streams[0]) // Source
      }
    })
    .then(resolve)
    .catch(reject)
  })
}

module.exports = {

  getStream: getStream

}

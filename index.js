const https = require('https')
const { escape } = require('querystring')

/*
 Example Usage

  let twitch = new Twitch({
    channel: 'TwitchUser'
  })

  async function test () {
    try {
      let url = await twitch.getStreamURL()
      console.log(url)
      let meta = await twitch.getStreamMeta()
      console.log(meta)
    } catch (error) {
      console.error(error)
    }
  }

  test()
*/

class Twitch {

  constructor (opts = {}) {
    if (opts.channel === undefined || opts.channel === '') {
      throw new Error('opts.channel must be set')
    }

    this.channel = opts.channel
    this.audio_only = opts.audio_only !== undefined ? opts.audio_only : false

    this.__auth = {}
    this.__m3u8 = null

  }

  async getStreamURL () {
    try {
      let raw = await this.__getStreamRAW()
      return Promise.resolve(raw.url)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  async getStreamMeta () {
    try {
      let raw = await this.__getStreamRAW()
      return Promise.resolve(raw.stream_info)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  async __getStreamRAW () {
    try {
      this.__auth = await this.__getAuth()
      this.__m3u8 = await this.__getStreamManifest()
      this.__m3u8Parsed = await this.__parseStreamManifest()

      if (this.audio_only) {
        return Promise.resolve(this.__m3u8Parsed.streams[this.__m3u8Parsed.streams.length - 1]) // Audio
      } else {
        return this.__m3u8Parsed.streams[0] // Source
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  __getAuth () {
    return new Promise((resolve, reject) => {
      https.request({
        hostname: 'api.twitch.tv',
        port: 443,
        path: `/api/channels/${this.channel}/access_token`,
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
          return reject({
            code: res.statusCode,
            message: 'unable to get twitch auth'
          })
        }
      })
      .on('error', e => {
        return reject(e)
      })
      .end()
    })
  }

  __getStreamManifest () {
    return new Promise((resolve, reject) => {
      https.request({
        hostname: 'usher.ttvnw.net',
        port: 443,
        path: `/api/channel/hls/${this.channel}.m3u8?allow_source=true&allow_audio_only=true&allow_spectre=false&sig=${this.__auth.sig}&token=${escape(this.__auth.token)}`,
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
          if (res.statusCode === 404) {
            return reject({
              code: res.statusCode,
              message: `${this.channel} is offline`
            })
          } else {
            return reject({
              code: res.statusCode,
              message: 'invaild status code'
            })
          }

        }
      })
      .on('error', e => {
        return reject(e)
      })
      .end()
    })
  }

  __getKeyValuePairs (data) {
    let properties = data.split(':')[1].split(',')
    let keyVals = {}
    properties.forEach((property, index) => {
      let keyVal = property.replace(/\"/g, '').split('=')
      if (keyVal[1] !== undefined) {
        keyVals[keyVal[0].replace(/\-/g, '_').toLowerCase()] = this.__normailzeValue(keyVal[1])
      } else {
        let _key = Object.keys(keyVals)[index-1]
        keyVals[_key] = this.__normailzeValue(`${keyVals[_key]},${keyVal[0]}`)
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

  __normailzeValue (value) {
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

  __parseStreamManifest () {
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
      this.__m3u8.split(/[\r\n]/).forEach((data, index) => {
        if (data !== '#EXTM3U') {
          if (data.startsWith('#EXT-X-TWITCH-INFO')) {
            parsed.twitch_info = this.__getKeyValuePairs(data)
          } else {
            switch(index % 3) {
              case 2:
                // X-MEDIA
                meta.media = this.__getKeyValuePairs(data)
                break;
              case 0:
                // X-STREAM
                meta.stream_info = this.__getKeyValuePairs(data)
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

}

module.exports = {

  Twitch: Twitch

}

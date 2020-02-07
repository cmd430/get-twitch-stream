const { request } = require('https')
const { escape } = require('querystring')

/*
 Example Usage

  let twitch = new Twitch({
    channel: 'TwitchUser'
  })

  async function test () {
    try {

      let availableQualities = await twitch.getStreamQualities()
      console.log(availableQualities)

      let url = await twitch.getStreamURL([
        'source'
      ])
      console.log(url)
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

    this.channel = opts.channel.toLowerCase()
    
    this.__client_id = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
  }

  async getStreamURL (qualities = [ 'source' ]) {
    try {
      let raw = await this.__getStreamRAW()

      if (Array.isArray(qualities) && qualities.length > 0) {
        let streamQuality = qualities.find(quality => {
          return raw.stream_qualities.includes(quality)
        })

        if (streamQuality !== undefined) {
          return Promise.resolve(raw.streams[streamQuality].url)
        } else {
          return Promise.reject(new Error(`no streams found for ${qualities.length > 1 ? 'qualities' : 'quality'} '${qualities}'`))
        }
      } else {
        return Promise.reject(new Error('invalid quality, must be array containing vaild quality'))
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  async getStreamQualities () {
    try {
      let raw = await this.__getStreamRAW()

      return Promise.resolve(raw.stream_qualities)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  async streamLive () {
    try {
      let auth = await this.__getAuth()

      await this.__getStreamManifest(auth)

      return Promise.resolve(true)
    } catch (error) {
      if (error.message === `${this.channel} is offline`) {
        return Promise.resolve(false)
      } else {
        return Promise.reject(error)
      }
    }
  }
  
  getStreamTitle (channel) {
    return new Promise((p_resolve, p_reject) => {
      request({
        hostname: 'api.twitch.tv',
        port: 443,
        path: `/api/channels/${this.channel}`,
        method: 'GET',
        headers: {
          'Client-ID': `${this.__client_id}`
        }
      }, res => {
        if (res.statusCode === 200) {
          let data = ''
          res.on('data', d => {
            data += d
          })
          res.on('end', () => {
            return p_resolve(JSON.parse(data).status)
          })
        } else {
          return p_resolve('Unknown Stream Title')
        }
      })
      .on('error', e => {
        debug(e.message)

        return p_resolve('Unknown Stream Title')
      })
      .end()
    })
  }

  async __getStreamRAW () {
    try {
      let auth = await this.__getAuth()
      let m3u8 = await this.__getStreamManifest(auth)
      return this.__parseStreamManifest(m3u8)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  __getAuth () {
    return new Promise((resolve, reject) => {
      request({
        hostname: 'api.twitch.tv',
        port: 443,
        path: `/api/channels/${this.channel}/access_token`,
        method: 'GET',
        headers: {
          'Client-ID': `${this.__client_id}`
        }
      }, res => {
        if (res.statusCode === 200) {
          let data = ''
          res.on('data', d => {
            data += d
          })
          res.on('end', () => {
            return resolve(JSON.parse(data).status)
          })
        } else {
          return reject(new Error('unable to get twitch auth'))
        }
      })
      .on('error', e => {
        return reject(e)
      })
      .end()
    })
  }

  __getStreamManifest (auth) {
    return new Promise((resolve, reject) => {
      request({
        hostname: 'usher.ttvnw.net',
        port: 443,
        path: `/api/channel/hls/${this.channel}.m3u8?player=twitchweb&allow_source=true&allow_audio_only=true&allow_spectre=false&sig=${auth.sig}&token=${escape(auth.token)}&type=any`,
        method: 'GET',
        headers: {
          'Client-ID': `${this.__client_id}`
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
            return reject(new Error(`${this.channel} is offline`))
          } else {
            return reject(new Error(res.statusMessage))
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

  __parseStreamManifest (m3u8) {
    return new Promise((resolve, reject) => {
      let parsed = {
        twitch_info: {},
        streams: {},
        stream_qualities: []
      }
      let meta = {
        media: {},
        stream_info: {},
        url: null
      }
      m3u8.split(/[\r\n]/).forEach((data, index) => {
        if (data !== '#EXTM3U') {
          if (data.startsWith('#EXT-X-TWITCH-INFO')) {
            parsed.twitch_info = this.__getKeyValuePairs(data)
          } else {
            switch(index % 3) {
              case 2:
                // X-MEDIA
                let parsedKeyValuePairs = this.__getKeyValuePairs(data)
                if (parsedKeyValuePairs.type === 'VIDEO') {
                  if (parsedKeyValuePairs.name.includes('(source)')) {
                    parsed.stream_qualities.push('source')
                    parsed.stream_qualities.push(parsedKeyValuePairs.name.replace('(source)', '').trim())
                  } else {
                    parsed.stream_qualities.push(parsedKeyValuePairs.name)
                  }
                } else if (parsedKeyValuePairs.type === 'AUDIO') {
                  parsed.stream_qualities.push('audio')
                }
                meta.media = parsedKeyValuePairs
                break;
              case 0:
                // X-STREAM
                meta.stream_info = this.__getKeyValuePairs(data)
                break;
              case 1:
                // M3U8 URL
                meta.url = data
                if (meta.media.name.includes('(source)')) {
                  parsed.streams['source'] = meta
                  parsed.streams[meta.media.name.replace('(source)', '').trim()] = meta
                } else if (meta.media.name === 'audio_only') {
                  parsed.streams['audio'] = meta
                } else {
                  parsed.streams[meta.media.name] = meta
                }
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

module.exports = Twitch

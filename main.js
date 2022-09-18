const express = require('express');
const mysql = require('mysql');
const moment = require('moment');
const qs = require('qs');
const fs = require('fs');
const axios = require('axios');
// require a slovenian moment locale
require('moment/locale/sl');

const bodyParser = require("body-parser");
const app = express();
const port = 3000;

const json_vars = require('./config.json');
const spotifyRefreshToken = json_vars.refresh_token;

//response params consts
const response_params = {
  validateId: {
    status: 400,
    msg: "Invalid id"
  },
  checkAuth: {
    status: 401,
    msg: "Unauthorized"
  },
  invalidRequest: {
    status: 400,
    msg: "Invalid request"
  },
  checkUser: {
    status: 400,
    msg: "Invalid user"
  },
  missingLog: {
    status: 400,
    msg: "No log with the given id"
  }
}

// load the environment variables
require('dotenv').config();

// set moment locale to slovenian
moment().locale('sl');

// define the body parsers
const jsonParser = bodyParser.json();
const urlencodedParser = bodyParser.urlencoded({ extended: false });

// create the connection to the database with loaded environment variables
const connection = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_BASE
})

// connect to the database
  connection.query("SET NAMES utf8mb4", function (error, results, fields) {
    if (error) {
      console.log(error)
    }
    console.log("SET utf8mb4");
  });
  console.log('DB connected');

// Functions

// Automation
let spotifyRecentToken = json_vars.access_token
let spotifyExpiresAt = json_vars.expires
const spotifyRecentLimit = 50
const spotifyRecentHoursPeriod = 2.5

const wakaTimeAPIKey = process.env.WAKATIME_BASE64_API_KEY
const codingHoursPeriod = 24

const hoursToMiliseconds = function (hours) {
  return hours * 60 * 60 * 1000
}

const checkAuthentication = function () {
  const nowTime = (new Date()).getTime()
  return (nowTime < spotifyExpiresAt)
}

const refreshSpotifyAccessToken = async function () {
  const options = {
    url: 'https://accounts.spotify.com/api/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + (Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET, 'utf-8').toString('base64'))
    },
    data: qs.stringify({
      grant_type: 'refresh_token',
      refresh_token: spotifyRefreshToken
    })
  }
  const res = await axios(options).catch(err => {
    console.log("AXIOS ERROR: refreshSpotifyAccessToken")
    console.log(err)
  });

  spotifyRecentToken = res.data.access_token
  json_vars.refresh_token = spotifyRefreshToken
  json_vars.access_token = spotifyRecentToken
  json_vars.expires = (new Date()).getTime() + (res.data.expires_in * 1000)

  fs.writeFile('./config.json', JSON.stringify(json_vars, null, 2), function (err) {
    if (err) {
      console.log(err)
    } else {
      console.log('Spotify configs saved to config.json')
    }
  })
  return true
}

const spotifyAutomation = setInterval(async function () {
  if (!checkAuthentication()) {
    const successRefresh = await refreshSpotifyAccessToken()
    console.log('Access token Refreshed')
  }
  // get the current time
  const currentTimeMS = (new Date()).getTime()
  const paramAfter = currentTimeMS - hoursToMiliseconds(spotifyRecentHoursPeriod)
  console.log(paramAfter)
  axios.get('https://api.spotify.com/v1/me/player/recently-played?limit=' + spotifyRecentLimit + '&after=' + paramAfter, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + spotifyRecentToken
    }
  }).then(async function (response) {
    console.log(response.data)
    const tracks = response.data.items
    if (tracks == undefined || tracks == null) {
      return
    }
    tracks.forEach(function (track) {
      const trackName = track.track.name
      const trackArtist = track.track.artists[0].name
      const trackDuration = track.track.duration_ms
      const trackPlayedAt = track.played_at
      const trackPlayedAtUnix = moment(trackPlayedAt).unix()
      const trackEnded = trackPlayedAtUnix + (trackDuration / 1000)  // in seconds
      const logObj = {
        name: "Spotify",
        description: trackArtist + "\n" + trackName,
        start: new Date(trackPlayedAtUnix * 1000),
        end: new Date(Math.floor(trackEnded) * 1000),
        category: "Entertainment:Music",
        metadata_token: process.env.AUTOMATION_METADATA_TOKEN,
        auth_token: process.env.AUTH_TOKEN
      }

      const fieldsResponse = checkLogFields(logObj)
      if (fieldsResponse.length < 1) {
        console.log("No fields to insert")
      }
      if (fieldsResponse.length == 1) {
        console.log("Formatting Error")
      }

      const setFields = fieldsResponse[0]
      const setValues = fieldsResponse[1]

      insertLog(setFields, setValues)
    })
  }).catch(function (error) {
    console.log(error)
  })
}, hoursToMiliseconds(spotifyRecentHoursPeriod))

const codingAutomation = setInterval(async function () {
  const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD')
  console.log(yesterday)
  axios.get('https://wakatime.com/api/v1/users/current/durations?date=' + yesterday + '&slice_by=language', {
    headers: {
      'Authorization': 'Basic ' + wakaTimeAPIKey
    }
  }).then(async function (response) {
    console.log(response.data)
    const codingDurations = response.data.data
    if (codingDurations == undefined || codingDurations == null) {
      return
    }
    codingDurations.forEach(function (codingDuration) {
      const codingDurationName = codingDuration.language // programming language
      const codingDurationProject = codingDuration.project // project name
      const codingDurationStartTime = codingDuration.time // float UNIX Epoch time
      const codingDurationDuration = codingDuration.duration // in seconds
      const codingDurationEndTime = codingDurationStartTime + codingDurationDuration // in seconds

      const logObj = {
        name: codingDurationName,
        description: "VSCode (" + codingDurationProject + " - " + codingDurationName + ")",
        start: new Date(Math.floor(codingDurationStartTime) * 1000),
        end: new Date(Math.floor(codingDurationEndTime) * 1000),
        category: "Work:Hobby:Programming",
        metadata_token: process.env.AUTOMATION_METADATA_TOKEN,
        auth_token: process.env.AUTH_TOKEN
      }

      const fieldsResponse = checkLogFields(logObj)
      if (fieldsResponse.length < 1) {
        console.log("No fields to insert")
      }
      if (fieldsResponse.length == 1) {
        console.log("Formatting Error")
      }

      const setFields = fieldsResponse[0]
      const setValues = fieldsResponse[1]

      insertLog(setFields, setValues)

  })}).catch(function (error) {
    console.log(error)
  })
}, hoursToMiliseconds(codingHoursPeriod))

// Express

const current_mysql_datetime = function () {
  const now = new Date()
  return mysql_datetime(now)
}

const current_mysql_datetime_slovenian = function () {
  const now = new Date()
  return mysql_datetime_slovenian(now)
}

const mysql_datetime = function (now) {
  return now.toISOString().slice(0, 19).replace('T', ' ')
}

const mysql_datetime_slovenian = function (now) {
  moment.locale('sl')
  return moment(now).format('YYYY-MM-DD HH:mm:ss')
}

const isValidJSON = function (str) {
  try {
    JSON.parse(str)
  } catch (e) {
    return false
  }
  return true
}

const checkAuth = function (body) {
  if (!body) {
    return false
  }
  if (!body.auth_token) {
    return false
  }
  else {
    return (body.auth_token == process.env.AUTH_TOKEN)
  }
}

const validateNumber = function (number) {
  const valNum = parseInt(number);
  if (isNaN(valNum)) {
    return false
  }
  return valNum
}

const validatePositiveNumber = function (posNum) {
  const valNum = validateNumber(posNum)
  if (!valNum) {
    return false
  }
  if (valNum < 0) {
    return false
  }
  return valNum
}

const getMetadataStatus = function (meta_token) {
  // decode the base64 token
  const decodedToken = Buffer.from(meta_token, 'base64').toString('utf-8')
  if (meta_token == Buffer.from(decodedToken, 'utf-8').toString('base64')) {
    if (isValidJSON(decodedToken)) {
      const metadata = JSON.parse(decodedToken)
      if (metadata.user && metadata.platform) {
        return [metadata.user, metadata.platform]
      }
      else {
        return [[400, "Invalid metadata properties"]]
      }
    }
    else {
      return [[400, "Invalid metadata format"]]
    }
  }
  else {
    return [[400, "Invalid metadata conversion"]]
  }
}

const checkUser = function (body) {
  if (!body) {
    return false
  }
  if (!body.metadata_token) {
    return false
  }
  const metadataArray = getMetadataStatus(body.metadata_token);
  if (metadataArray.length != 2) {
    return false
  }
  return metadataArray[0]
}

const capitalize = function (str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

const checkLogFields = function (body) {
  const now = moment()
  const datetime = mysql_datetime(now)
  const datetime_slovenian = mysql_datetime_slovenian(now)

  let setFields = []
  let setValues = []

  if (!body.name) {
    return [[400, "Missing name"]]
  }
  else {
    setFields.push("name")
    setValues.push(connection.escape(body.name))
  }

  if (body.description) {
    setFields.push("description")
    setValues.push(connection.escape(body.description))
  }

  if (!body.start) {
    setFields.push("start")
    setValues.push(connection.escape(datetime_slovenian))
  }
  else {
    setFields.push("start")
    const validDatetime = moment(body.start, 'YYYY-MM-DD HH:mm:ss').isValid()
    if (validDatetime) {
      setValues.push(connection.escape(body.start))
    }
    else {
      return [[400, "Invalid start datetime"]]
    }
  }

  if (body.end) {
    setFields.push("end")
    const validDatetime = moment(body.end, 'YYYY-MM-DD HH:mm:ss').isValid()
    if (validDatetime) {
      setValues.push(connection.escape(body.end))
    }
    else {
      return [[400, "Invalid end datetime"]]
    }
  }

  if (body.category) {
    setFields.push("category")
    const categoryArray = body.category.split(':')
    const capitalizedArray = categoryArray.map(category => capitalize(category))
    let validCategory = capitalizedArray.join(':')
    validCategory = (validCategory.slice(-1) == ':') ? validCategory : validCategory + ':'
    setValues.push(connection.escape(validCategory))
  }

  if (body.type) {
    setFields.push("type")
    setValues.push(connection.escape(body.type))
  }

  if (body.value) {
    setFields.push("value")
    setValues.push(connection.escape(body.value))
  }

  if (body.unit) {
    setFields.push("unit")
    setValues.push(connection.escape(body.unit))
  }

  if (body.lat) {
    setFields.push("lat")
    setValues.push(connection.escape(body.lat))
  }

  if (body.lng) {
    setFields.push("lng")
    setValues.push(connection.escape(body.lng))
  }

  if (!body.metadata_token) {
    return [[400, "Invalid request"]]
  }
  else {
    // decode the base64 token
    const decodedToken = Buffer.from(body.metadata_token, 'base64').toString('utf-8')
    if (body.metadata_token == Buffer.from(decodedToken, 'utf-8').toString('base64')) {
      if (isValidJSON(decodedToken)) {
        const metadata = JSON.parse(decodedToken)
        if (metadata.user && metadata.platform) {
          setFields.push("person")
          setValues.push(connection.escape(metadata.user))
          setFields.push("metadata_token")
          setValues.push(connection.escape(body.metadata_token))
        }
        else {
          return [[400, "Invalid metadata properties"]]
        }
      }
      else {
        return [[400, "Invalid metadata validity"]]
      }
    }
    else {
      return [[400, "Invalid request"]]
    }
  }

  setFields.push("datetime_created")
  setValues.push(connection.escape(datetime_slovenian))
  setFields.push("datetime_created_utc_zero")
  setValues.push(connection.escape(datetime))

  return [setFields, setValues]
}

const insertLog = function (setFields, setValues) {
  const insert_query = "insert into logs (" + setFields.join() + ") values (" + setValues.join() + ")"

  connection.query(insert_query, function (error, results, fields) {
    if (error != null) {
      const msg = "Query Error"
      console.log(error)
    }
    else {
      const msg = "Post request successfull!"
      console.log("insertLog " + msg)
      //TODO: returning has to be fixed  (async not working - query not promise based)
    }
  })
}


////////////////////////////////////////////////////////////////////////////////
// API routes
////////////////////////////////////////////////////////////////////////////////

app.get('/', (req, res) => {
  res.send('Logger Home!')
})

// Life logger

app.post('/api/v1/logs/recent/:id', jsonParser, (req, res) => {
  if (!checkAuth(req.body)) {
    return res.status(response_params.checkAuth.status).send(response_params.checkAuth.msg)
  }
  const id = validatePositiveNumber(req.params.id)
  if (!id) {	
    return res.status(response_params.validateId.status).send(response_params.validateId.msg)
  }
  const user = checkUser(req.body)
  if (!user) {
    return res.status(response_params.checkUser.status).send(response_params.checkUser.msg)
  }

  connection.query('SELECT * FROM logs WHERE start > DATE_SUB(DATE(now()), INTERVAL ? day) and (type = 0 or type is null) and person = ? ORDER BY start desc', [id, user], (err, rows, fields) => {
    if (err) {
      res.status(500).send(err)
    }
    else {
      res.json(rows)
    }
  })
})

////////////////////////////////////////////////////////////////////////////////

app.post('/api/v1/stats/recent/:days/', jsonParser, (req, res) => {
  if (!checkAuth(req.body)) {
    return res.status(response_params.checkAuth.status).send(response_params.checkAuth.msg)
  }
  const days = validatePositiveNumber(req.params.days)
  if (!days) {	
    return res.status(response_params.validateId.status).send(response_params.validateId.msg)
  }
  const user = checkUser(req.body)
  if (!user) {
    return res.status(response_params.checkUser.status).send(response_params.checkUser.msg)
  }

  connection.query('SELECT name, SUM(TIMESTAMPDIFF(MINUTE, start, end)) AS duration FROM `logs` WHERE start > DATE_SUB(DATE(now()), INTERVAL ? day) and type = 30 and person = ? GROUP BY name HAVING duration > 0 ORDER BY duration desc', [days, user], (err, rows, fields) => {
    if (err) {
      res.status(500).send(err)
    }
    else {
      res.json(rows)
    }
  })
})

app.post('/api/v1/stats/range/:start/:end', jsonParser, (req, res) => {
  if (!checkAuth(req.body)) {
    return res.status(response_params.checkAuth.status).send(response_params.checkAuth.msg)
  }
  const from = req.params.start
  if (!from) {	
    return res.status(response_params.validateId.status).send(response_params.validateId.msg)
  }
  const to = req.params.end
  if (!to) {
    return res.status(response_params.validateId.status).send(response_params.validateId.msg)
  }
  const user = checkUser(req.body)
  if (!user) {
    return res.status(response_params.checkUser.status).send(response_params.checkUser.msg)
  }

  connection.query('SELECT name, SUM(TIMESTAMPDIFF(MINUTE, start, end)) AS duration FROM `logs` WHERE start > DATE(?) and start < DATE(?) and type = 30 and person = ? GROUP BY name HAVING duration > 0 ORDER BY duration desc', [from, to, user], (err, rows, fields) => {
    if (err) {
      res.status(500).send(err)
    }
    else {
      res.json(rows)
    }
  })
})

////////////////////////////////////////////////////////////////////////////////

app.post('/api/v1/log', jsonParser, (req, res) => {
  if (!checkAuth(req.body)) {
    return res.status(response_params.checkAuth.status).send(response_params.checkAuth.msg)
  }

  const fieldsResponse = checkLogFields(req.body)
  if (fieldsResponse.length < 1) {
    return res.status(400).send('Invalid request')
  }
  if (fieldsResponse.length == 1) {
    return res.status(fieldsResponse[0][0]).send(fieldsResponse[0][1])
  }

  const setFields = fieldsResponse[0]
  const setValues = fieldsResponse[1]

  const insert_query = "insert into logs (" + setFields.join() + ") values (" + setValues.join() + ")"

  connection.query(insert_query, function (error, results, fields) {
    if (error != null) {
      const msg = "Query Error"
      console.log(error)
      res.status(500).send(msg)
    }
    else {
      const msg = "Post request successfull!"
      res.status(200).send(msg)
    }
  })
})

app.post('/api/v1/log/end', jsonParser, (req, res) => {
  if (!checkAuth(req.body)) {
    return res.status(response_params.checkAuth.status).send(response_params.checkAuth.msg)
  }

  const now = new Date()
  const datetime = mysql_datetime(now)
  const datetime_slovenian = mysql_datetime_slovenian(now)

  let setFields = []
  let setValues = []

  if (!req.body) {
    return res.status(response_params.invalidRequest.status).send(response_params.invalidRequest.msg)
  }

  if (!req.body.name) {
    return res.status(response_params.invalidRequest.status).send(response_params.invalidRequest.msg)
  }

  if (!req.body.end) {
    setFields.push("end")
    setValues.push(connection.escape(datetime_slovenian))
  }
  else {
    setFields.push("end")
    const validDatetime = moment(req.body.end, 'YYYY-MM-DD HH:mm:ss').isValid()
    if (validDatetime) {
      setValues.push(connection.escape(req.body.end))
    }
    else {
      return res.status(400).send("Invalid end datetime")
    }
  }

  
  let person = null
  if (!req.body.metadata_token) {
    return res.status(400).send("Invalid request")
  }
  else {
    // decode the base64 token
    const decodedToken = Buffer.from(req.body.metadata_token, 'base64').toString('utf-8')
    if (req.body.metadata_token == Buffer.from(decodedToken, 'utf-8').toString('base64')) {
      if (isValidJSON(decodedToken)) {
        const metadata = JSON.parse(decodedToken)
        if (metadata.user && metadata.platform) {
          person = metadata.user
        }
        else {
          return res.status(400).send("Invalid metadata properties")
        }
      }
      else {
        return res.status(400).send("Invalid metadata validity")
      }
    }
    else {
      return res.status(400).send("Invalid request")
    }
  }

  setFields.push("datetime_updated")
  setValues.push(connection.escape(datetime_slovenian))
  setFields.push("datetime_updated_utc_zero")
  setValues.push(connection.escape(datetime))

  const select_query = "select * from logs where person = '" + person + "' and name = '" + req.body.name + "' order by id desc limit 1"
  connection.query(select_query, function (error, results, fields) {
    if (error != null) {
      const msg = "Query Error"
      console.log(error)
      res.send(msg)
    }
    else {
      if (results.length == 0) {
        return res.status(400).send("Invalid entry")
      }
      else if (moment(results[0].start, 'YYYY-MM-DD HH:mm:ss').isValid()
        && moment(results[0].end, 'YYYY-MM-DD HH:mm:ss').isValid()) {
        return res.status(400).send("The event was concluded")
      }
      else {
        let descString = ""
        if ((results[0].description == null || results[0].description == "") && req.body.description != null && req.body.description != "") {
          descString = "description = " + connection.escape(req.body.description) + ","
        }
        const update_query = "update logs set " + descString + " end = " + setValues[0] + ", datetime_updated = " + setValues[1] + ", datetime_updated_utc_zero = " + setValues[2] + " where id = " + results[0].id
        connection.query(update_query, function (error, results, fields) {
          if (error != null) {
            const msg = "Query Error"
            console.log(error)
            res.send(msg)
          }
          else {
            const msg = "Update Post request successfull!"
            res.send(msg)
          }
        }
        )
      }
    }
  })
})

app.put('/api/v1/log/:id', jsonParser, (req, res) => {
  if (!checkAuth(req.body)) {
    return res.status(response_params.checkAuth.status).send(response_params.checkAuth.msg)
  }
  const id = validatePositiveNumber(req.params.id)
  if (!id) {	
    return res.status(response_params.validateId.status).send(response_params.validateId.msg)
  }
  const user = checkUser(req.body)
  if (!user) {
    return res.status(response_params.checkUser.status).send(response_params.checkUser.msg)
  }
  const select_query = "select * from logs where id = " + id + " and person = '" + user + "'"
  console.log(select_query)
  connection.query(select_query, function (error, results, fields) {
    if (error != null) {
      const msg = "Query Error"
      console.log(error)
      res.send(msg)
    }
    else {
      if (results.length == 0) {
        return res.status(response_params.missingLog.status).send(response_params.missingLog.msg)
      }
      else {
        let fields = []
        const startend = validateNumber(req.body.startend)
        const start = validateNumber(req.body.start)
        const end = validateNumber(req.body.end)
        if (startend) {
          fields.push({start: startend})
          if (results[0].end) {
            fields.push({end: startend})
          }
        }
        else if (start) {
          fields.push({start: start})
        }
        else if (end) {
          if (results[0].end) {
            fields.push({end: end})
          }
          else {
            return res.status(400).send("Request hasn't ended yet")
          }
        }
        else {
          return res.status(response_params.invalidRequest.status).send(response_params.invalidRequest.msg)
        }
        let setString = ""
        fields.forEach(function (field) {
          setString += Object.keys(field)[0] + " = date_add(" + Object.keys(field)[0] + ", interval " + connection.escape(field[Object.keys(field)[0]]) + " minute)"
          if (fields.indexOf(field) != fields.length - 1) {
            setString += ", "
          }
          
        })

        const update_query = "update logs set " + setString + " where id = " + id
        console.log(update_query)

        connection.query(update_query, function (error, results, fields) {
          if (error != null) {
            const msg = "Query Error"
            console.log(error)
            res.send(msg)
          }
          else {
            res.send("Update Post request successfull!")
          }
        })
      }
    }
  })
})

app.delete('/api/v1/log/:id', jsonParser, (req, res) => {
  if (!checkAuth(req.body)) {
    return res.status(response_params.checkAuth.status).send(response_params.checkAuth.msg)
  }
  const id = validatePositiveNumber(req.params.id)
  if (!id) {	
    return res.status(response_params.validateId.status).send(response_params.validateId.msg)
  }
  const user = checkUser(req.body)
  if (!user) {
    return res.status(response_params.checkUser.status).send(response_params.checkUser.msg)
  }
  const select_query = "select * from logs where id = " + id + " and person = '" + user + "'"
  console.log(select_query)
  connection.query(select_query, function (error, results, fields) {
    if (error != null) {
      const msg = "Query Error"
      console.log(error)
      res.send(msg)
    }
    else {
      if (results.length == 0) {
        return res.status(response_params.missingLog.status).send(response_params.missingLog.msg)
      }
      else {
        const delete_query = "delete from logs where id = " + id
        console.log(delete_query)
        connection.query(delete_query, function (error, results, fields) {
          if (error != null) {
            const msg = "Query Error"
            console.log(error)
            res.send(msg)
          }
          else {
            const msg = "Delete request successfull!"
            res.send(msg)
          }
        })
      }
    }
  })
})

app.listen(port, () => {
  console.log(`Life logger listening on port ${port}`)
})

process.on('exit', () => {
  connection.end(function (err) {
    console.log("Connection is terminated!")
  })
})

/**
 * TYPES:
 * O || null: normal log
 * 1: spotify automation
 * 20: vscode automation (before the processing)
 * 21: vscode automation (after the processing)
 * 30: precise windows logging (before the processing)
 * 31: precise windows logging (after the processing)
 */
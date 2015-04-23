var config = require('./config.js');
var connect = require("express");
var request = require("request-promise");
var crypto = require("crypto");
var qs = require("querystring");
var _ = require("lodash");
var EventEmitter = require("events").EventEmitter;
var WebSocketServer = require("ws").Server;
var Q = require('q');
var redis = require('simple-redis-connection');

var app = connect();
var redisConnection = redis(config.redisUri);

var requestLocation = _.template("https://api.github.com/repos/<%= repoSlug %>?access_token=<%= access_token %>");
var repoSlug = _.template("<%= owner%>/<%= repo %>");
var hashed = _.template("<%= repoSlug %><%= token %>");

function parse(input) {
    try {
        return JSON.parse(input);
    } catch(e) {
        return null;
    }
}

function validateTravis(inputAuth, repoSlug, token) {
    var hasher = crypto.createHash('sha256');

    hasher.update(rawAuthorization = hashed({
        repoSlug: repoSlug,
        token: token
    }), "utf8");

    return (hasher.digest("hex") === inputAuth);
}
var statuses = {
    Passed: "passed",
    Fixed: "passed",
    Broken: "failed",
    Failed: "failed",
    "Still Failing": "failed"
};
function updateStatus(slug, status) {
    if (!statuses.hasOwnProperty(status)) {
        return;
    }
    status = statuses[status];
    var message = [slug, status].join(":");
    redis.hset("travisCache", slug, status, function() {});
    _.each(_.values(sockets), function(socket) {
        socket.send(message);
    });
}
app.post('/travisHook', function (req, res) {
    function fail() {
        res.writeHead(403);
        res.end();
    }

    if (!req.body.hasOwnProperty("payload") || !req.headers.hasOwnProperty("authorization")) {
        return fail();
    }

    var payload = parse(req.body.payload);

    if (payload === null
        || !payload.hasOwnProperty("repository")
        || !payload.repository.hasOwnProperty("name")
        || !payload.repository.hasOwnProperty("owner_name")
        || !payload.hasOwnProperty("branch")
        || !payload.hasOwnProperty("status_message")) {
        return fail();
    }

    var branch = payload.branch;
    var status = payload.status_message;
    var slug = repoSlug({
        owner: payload.repository.owner_name,
        repo: payload.repository.name
    });

    if (!validateTravis(req.headers.authorization, slug, config.travisToken)) {
        return fail();
    }
    res.end("");

    return request({
        uri: requestLocation({
            repoSlug: slug,
            access_token: config.githubToken
        }),
        headers: {
            "User-Agent": config.githubUa
        }
    }).then(function(body) {
        return parse(body);
    }).then(function(githubResponse) {
        return (githubResponse.hasOwnProperty("default_branch")) ? githubResponse.default_branch : null;
    }).then(function(default_branch) {
        if (default_branch !== branch) {
            return;
        }
        updateStatus(slug, status)
    });
});

var server = require('http').Server(app);

var wss = new WebSocketServer({
    server: server,
    verifyClient: function(info) {
        return info.req.url === config.wsPath;
    }
});

var uid = 0;
var sockets = {};

wss.on("connection", function(socket) {
    socket.on("ping", function() {
        socket.pong("", {}, true);
    });

    Q.npost(redisConnection, "hgetall", ["travisCache"]).then(function(result) {
        _.forEach(result, function(status, slug) {
            socketObject.send([slug, status].join(":"));
        });
    });

    function socketError() {
        if (!this.open) {
            return;
        }
        this.open = false;
        delete sockets[socketObject.id];
    }

    var socketObject = {
        id: uid++,
        send: function(data) {
            if (!socketObject.open) {
                return;
            }
            try {
                socket.send(data);
            } catch (e) {
                socketError();
            }
        },
        open: true
    };

    socket.on("error", socketError);
    socket.on("close", socketError)
});

server.listen(config.port);

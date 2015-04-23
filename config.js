module.exports = (function(_, fs) {
    return _.assign({
        githubUa: "A misconfigured piece of software. (originally by terribleplan)",
        port: 3000
    }, _.pick(_.mapValues({
        travisToken: "TRAVIS_TOKEN",
        githubToken: "GITHUB_TOKEN",
        githubUa: "GITHUB_UA",
        redisUri: "REDISLAB_URI",
        port: "PORT",
        wsPath: "WS_PATH"
    }, function(val) {
        return process.env[val];
    }), _.identity), fs.existsSync("./local-config.json") ? require("./local-config.json") : {});
})(require("lodash"), require("fs"));

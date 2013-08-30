var _ = require("underscore")
    , async = require("async")
    , fs = require("fs")
    , jade = require("jade")
    , md = require("node-markdown").Markdown
    , path = require("path")
    , url = require("url");

//var mainPath = path.resolve(path.dirname(require.main.filename));

var schemas = {};

function resolvePath(path){

    var p = url.parse(path);
    var nest = p.pathname.split("/");
    var current = schemas;

    for (var i=1; i<nest.length; i++){
        if (current[nest[i]]) {
            current = current[nest[i]];
        } else throw "No object found for "+nest[i]+" in URI "+ p.pathname;
    }
//    console.log(path, current);

    return current;
}

function crawl(obj,id){

    if (_.isUndefined(obj)) return {};
    if (!id) id=obj.id?obj.id:"";

    if (obj["$ref"])
        return crawl(resolvePath(obj["$ref"]),id);


    _.each(obj,function(v,k){
        if (_.isObject(v)) obj[k] = crawl(v,id);
    });

    return obj;
}

function heredoc(fn) {
    var splitString = fn.toString().split('\n');
    var leadingSpaces = splitString[1].split(/[^ \t\r\n]/)[0].length;
    for (var i=0; i<splitString.length; i++)
        splitString[i] = splitString[i].substr(leadingSpaces);
    return splitString.slice(1,-1).join('\n')+'\n';//fn.toString().split('\n').slice(1,-1).join('\n') + '\n'
}

function desc(str){
    if (str){
        if (_.isFunction(str)){
            str = heredoc(str);
        }
        return md(str);
    }
    else return "No description yet"
}

function rip(name, res){
    var m = [];
    for (var i = 0; i < res.resources.length; i++){
        var r = res.resources[i];
        m.push(
            {
                description: desc(r.description),
                method: r.method,
                noAuth: r.noAuth,
                obsolete: r.obsolete,
                schema: r.schema,
                filters: r.filters,
                stub: r.stub,
                uri: r.uri
            }
        );
    }

    return {
        version: res.version,
        description: desc(res.description),
        resources: m
    }
}

module.exports = function(settings){

    if (_.isUndefined(settings)) settings = {docker: {}};

    settings = _.defaults(settings,{
        dockerTemplates: __dirname+"/../templates",
        dockerOutput: fs.realpathSync(path.resolve(path.dirname(require.main.filename),'public','docker')),
        apiPath: fs.realpathSync(path.resolve(path.dirname(require.main.filename),'api')),
        schemaPath: fs.realpathSync(path.resolve(path.dirname(require.main.filename),'schema')),
        projectName: "Unnamed project"
    });

    var resources = fs.readdirSync(settings.apiPath);
    var schemaFiles = fs.readdirSync(settings.schemaPath);

    var data = {names: [],
        project: settings};

    var api = {};

    _.each(resources, function(resource){
        if (resource.indexOf(".js")==resource.length-3){
            var name = resource.substring(0,resource.length-3);
            api[name] = rip(name,require(path.join(settings.apiPath,resource)));
            data.names.push(name);
        }
    });

    // Generating API documentation
    async.waterfall([

        //Load schemas
        function(callback){
            async.each(schemaFiles,
                function(name,callback){
                    if (name.indexOf(".json")==name.length-5){
                        fs.readFile(path.join(settings.schemaPath,name),"utf8",function(err,sch){
                            if (err){
                                callback(err);
                            }
                            else {
                                schemas[name.substring(0,name.length-5)] = JSON.parse(sch);
                                callback(err);
                            }
                        });
                    }
                },
                function(err){
                    callback(err);
                });
        },

        // Get schema template
//        function(callback){
//
//            fs.readFile(path.join(tplDIR,"resource.jade"),"utf8", function(err,tpl){callback(err,tpl)});
//        },
//
//        //Generate schema pages
//        function(tpl, callback){
//            var fn = jade.compile(tpl,{filename: path.join(tplDIR,"templates")});
//        },

        // Get resource template
        function(callback){
            schemas = crawl(schemas);
            fs.readFile(path.join(settings.dockerTemplates,"resource.jade"),"utf8", function(err,tpl){callback(err,tpl)});
        },

        //Generate resource pages
        function(tpl, callback){
            var fn = jade.compile(tpl,{filename: path.join(settings.dockerTemplates,"templates")});
            async.each(data.names,
                function(name,callback){
                    fs.writeFile(
                        path.join(settings.dockerOutput,name+".html"),
                        fn({data: data, current: name, api: api[name], schemas: schemas}),callback);
                },
                function(err){
                    callback(err);
                });
        },

        // Get the index template
        function(callback){
            fs.readFile(path.join(settings.dockerTemplates,"index.jade"),"utf8", function(err,tpl){callback(err,tpl)});
        },

        // Generate index file
        function(tpl,callback) {
            var fn = jade.compile(tpl,{filename: path.join(settings.dockerTemplates,"templates")});
            fs.writeFile(
                path.join(settings.dockerOutput,"index.html"),
                fn({data: data}),
                function(err){callback(err,"Docker finished generating API documentation")});
        }
    ],

        // Done generating the documentation
        function(err,result){
            if (err) throw err;
            console.log(result);
        });
};
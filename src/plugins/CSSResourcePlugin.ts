import { File } from "../File";
import { Plugin, WorkFlowContext } from "../WorkflowContext";
import { ensureUserPath, ensureDir } from "../Utils";
import * as path from "path";
import { utils } from "realm-utils";
import * as fs from "fs";
import { PostCSSResourcePlugin } from "../lib/postcss/PostCSSResourcePlugin";
import { SVG2Base64 } from "../lib/SVG2Base64";
const base64Img = require("base64-img");
const postcss = require("postcss");
const IMG_CACHE = {};
let resourceFolderChecked = false;

const copyFile = (source, target) => {
    return new Promise((resolve, reject) => {
        fs.exists(source, (exists) => {
            if (!exists) {
                return resolve();
            }
            let rd = fs.createReadStream(source);
            rd.on("error", (err) => {
                return reject(err);
            });
            let wr = fs.createWriteStream(target);
            wr.on("error", (err) => {
                return reject(err);
            });
            wr.on("close", (ex) => {
                return resolve();
            });
            rd.pipe(wr);
        });
    });
};

const generateNewFileName = (str): string => {
    let s = str.split("node_modules");
    const ext = path.extname(str);
    if (s[1]) {
        str = s[1];
    }
    let hash = 0;
    let i;
    let chr;
    let len;
    if (str.length === 0) { return hash.toString() + ext; }
    for (i = 0, len = str.length; i < len; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    let fname = hash.toString() + ext;
    if (fname.charAt(0) === "-") {
        fname = "_" + fname.slice(1);
    }
    return fname;
};

/**
 * @export
 * @class RawPluginClass
 * @implements {Plugin}
 */
export class CSSResourcePluginClass implements Plugin {

    public test: RegExp = /\.css$/;
    public distFolder: string;
    public inlineImages: false;
    constructor(opts: any) {
        opts = opts || {};
        if (opts.dist) {
            this.distFolder = ensureDir(opts.dist);
        }

        if (opts.inline) {
            this.inlineImages = opts.inline;
        }
        if (utils.isFunction(opts.resolve)) {
            this.resolveFn = opts.resolve;
        }
    }

    public init(context: WorkFlowContext) {
        context.allowExtension(".css");
    }

    public resolveFn = (p) => path.join("/css-resources", p)

    public createResouceFolder(file: File) {
        if (resourceFolderChecked === false) {

            resourceFolderChecked = true;
            if (this.distFolder) {
                return;
            }
            // making sure dist folder exists
            let outFilePath = ensureUserPath(file.context.outFile);
            let outFileDir = path.dirname(outFilePath);
            this.distFolder = ensureDir(path.join(outFileDir, "css-resources"));
        }
    }



    public transform(file: File) {
        file.loadContents();
        let contents = file.contents;
        if (this.distFolder) {
            this.createResouceFolder(file);
        }
        const currentFolder = file.info.absDir;
        const files = {};
        const tasks = [];

        return postcss([PostCSSResourcePlugin({
            fn: (url) => {
                let urlFile = path.resolve(currentFolder, url);
                if (this.inlineImages) {
                    if (IMG_CACHE[urlFile]) {
                        return IMG_CACHE[urlFile];
                    }
                    const ext = path.extname(urlFile);
                    let fontsExtensions ={
                        '.woff': 'application/font-woff',
                        '.woff2': 'application/font-woff2',
                        '.eot': 'application/vnd.ms-fontobject',
                        '.ttf': 'application/x-font-ttf',
                        '.otf': 'font/opentype'
                    };
                    if(fontsExtensions[ext]) {
                        let content = new Buffer(fs.readFileSync(urlFile)).toString('base64');
                        return `data:${fontsExtensions[ext]};charset=utf-8;base64,${content}`;
                    }
                    if (ext === ".svg") {
                        let content = SVG2Base64.get(fs.readFileSync(urlFile).toString());
                        IMG_CACHE[urlFile] = content;
                        return content;
                    }
                    let result = base64Img.base64Sync(urlFile);
                    IMG_CACHE[urlFile] = result;
                    return result;
                }

                // copy files
                if (this.distFolder) {
                    let newFileName = generateNewFileName(urlFile);
                    if (!files[urlFile]) {
                        let newPath = path.join(this.distFolder, newFileName);
                        tasks.push(copyFile(urlFile, newPath));
                        files[urlFile] = true;
                    }
                    return this.resolveFn(newFileName);
                }
            },
        })]).process(contents).then(result => {
            file.contents = result.css;
            return Promise.all(tasks);
        });
    }
}

export const CSSResourcePlugin = (options) => {
    return new CSSResourcePluginClass(options);
};
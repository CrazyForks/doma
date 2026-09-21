import { STUserscriptBean } from "../database/userscript/STUserscriptBean";
import { STUserscriptDatabase } from "../database/userscript/STUserscriptDatabase";
import { STCodeDatabase } from "../database/code/STCodeDatabase";
import { STDatabaseFactory } from "../database/STDatabaseFactory";
import { getCurrentUserId } from "../currentUserId";
import { STFileManager } from "../STFileManager";
import { MatchPattern } from "./MatchPattern";
import type { STRecordValueType } from "../STDataType";
import { withDatabaseResource, STDatabase } from "../database/STDatabase";
import { Engine } from "./gm/Engine";
import { Handler } from "./Handler";

export class StayWebExtensionHandler extends Handler{
    engine: Engine = new Engine();
  

    public async handle(message: any, sender: any, sendResponse: (response: any) => void, context?: any){
        try{
            console.log(`beginRequestWithExtensionContext: ${message}`);
            const response: Record<string, any> = {};
            let body: Record<string, any> = {};
            response.body= body;

            const type = message.operate as string;
            if (type === "background/v3/getInjectFiles"){
                console.log("getInjectFiles=========", sender);
                const jsFiles = new Array<Record<string, STRecordValueType>>();
                body["jsFiles"] = jsFiles;
                body["gmApi"] = "";
                body["allDependentScripts"] = {};
                const scriptHandler = this.name();
                const scriptHandlerVersion = this.version();
                let allDependentScripts: Record<string, string> = {};

                await withDatabaseResource<STDatabase>(async (userscriptDatabase, codeDatabase) => {
                    const userscriptMapper = (userscriptDatabase as STUserscriptDatabase).getUserscriptMapper();
                    const codeMapper = (codeDatabase as STCodeDatabase).getCodeMapper();

                    const userscripts = await userscriptMapper.listActiveWithoutContent(getCurrentUserId());
                    const url = sender.tab?.url;
                    if (!url){
                        sendResponse(response);
                        return;
                    }
                    const isTop = sender.frameId === 0;
    
                    for (let i = 0; i < userscripts.length; i++){
                        const userscript = userscripts[i];

                        if (userscript.usedNoFrames() && !isTop){
                            continue;
                        }

                        if (userscript.whiteList.length > 0){
                            if (!this.whiteListCheck(userscript, url)){
                                continue;
                            }
                        }
                        else{
                            if (!this.matchesCheck(userscript, url)){
                                continue;
                            }

                            const disabledUrl = this.disabledWebsitesCheck(userscript, url);
                            if (disabledUrl != null){
                                continue;
                            }

                            if (this.blackListCheck(userscript, url)){
                                continue;
                            }
                        }

                        let requiredScripts: Record<string, Record<string, string>> = {};
                        if (userscript.requireUrls.length > 0){
                            requiredScripts = await codeMapper.requireScripts(getCurrentUserId(), userscript.uuid);
                            const common = requiredScripts["common"] || {};
                            Object.entries(common).forEach(([url, content]) => {
                                allDependentScripts[url] = content;
                            });
                        }

                        const scriptMeta = {
                            "description": userscript.desc,
                            "excludes": userscript.excludes,
                            "includes": userscript.includes,
                            "matches": userscript.matches,
                            "name": userscript.name,
                            "namespace": userscript.namespace,
                            "resources": userscript.resourceUrls,
                            "run-at": userscript.usedRunAt(),
                            "version": userscript.version,
                            "author": userscript.author,
                            "homepage": userscript.homepage
                        } as Record<string, STRecordValueType>;

                        const scriptMetaStr = JSON.stringify(scriptMeta);

                        const metadata = scriptMeta;
                        const resourceUrls: Record<string, string> = userscript.resourceUrls;
                        let resourceTexts: Record<string, STRecordValueType> = {};
                        if (Object.keys(resourceUrls).length > 0){
                            resourceTexts = await codeMapper.resourceTexts(getCurrentUserId(), userscript.uuid);
                        }

                        metadata["grants"] = Array.from(new Set(userscript.grants));
                        metadata["icon"] = userscript.icon;
                        metadata["locales"] = userscript.locates;
                        metadata["inject-into"] = userscript.injectInto.toLowerCase();
                        metadata["noframes"] = userscript.usedNoFrames();

                        const content = await STFileManager.getInstance().getUserscript(getCurrentUserId(), userscript.uuid);

                        const script = {
                            "uuid": userscript.uuid,
                            "metadata": metadata,
                            "code": content,
                            "type": "js",
                            "scriptMetaStr": scriptMetaStr,
                            "requiredScripts": requiredScripts["inline"] || {},
                            "resourceUrls": resourceUrls,
                            "resourceTexts": resourceTexts
                        } as Record<string, STRecordValueType>;
                            
                        this.engine.installGMAPI(script, scriptHandler, scriptHandlerVersion);
                        jsFiles.push(script);
                    }

                }, STDatabaseFactory.userscriptDatabase(),STDatabaseFactory.codeDatabase());

                body["scriptHandler"] = scriptHandler;
                body["scriptHandlerVersion"] = scriptHandlerVersion;
                body["jsFiles"] = jsFiles;
                body["userId"] = getCurrentUserId();
                body["gmApi"] = this.engine.genGMAPI(jsFiles);
                body["allDependentScripts"] = allDependentScripts;
                sendResponse(response);
            }
        }catch(e){
            console.error(e);
            sendResponse({ body: { jsFiles: [], gmApi: "" } });
        }
    }

    convert2GlobsRegExp(str: string){
        const expr = new RegExp("^"+
        str.replace(/\./g,"\\.").replace(/\*/g,".*").replace("/*\\./g","(.*\\.)?")
          +"$","i");
        return expr;
      }
    
      matchesCheck(userscript: STUserscriptBean, url: string){
        let matched = false;
    
        const matches = userscript.matches;
        for (const match of matches){
          const matchPattern = new MatchPattern(match);
          if (matchPattern.doMatch(url)){
            matched = true;
            break;
          }
        }
    
        if (!matched){
          for (const match of matches){
            const fallbackMatchExpr = this.convert2GlobsRegExp(match);
            if (fallbackMatchExpr.test(url)){
              matched = true;
              break;
            }
          }
        }
    
        if (!matched){
          const includes = userscript.includes;
          for (const include of includes){
            const includeExpr = this.convert2GlobsRegExp(include);
            if (includeExpr.test(url)){
              matched = true;
              break;
            }
          }
        }
    
        if (matched){
          const excludes = userscript.excludes;
          for (const exclude of excludes){
            const excludeExpr = this.convert2GlobsRegExp(exclude);
            if (excludeExpr.test(url)){
              matched = false;
              break;
            }
          }
        }
    
        return matched;
      }
    
      disabledWebsitesCheck(userscript: STUserscriptBean, url: string): string | null{
        const blacklist = userscript.disabledWebsites;
        for (const black of blacklist){
          const blackExpr = this.convert2GlobsRegExp(black);
          if (blackExpr.test(url)){
            return black;
          }
        }
    
        return null;
      }

    whiteListCheck(userscript: STUserscriptBean, url: string){
        const whiteList = userscript.whiteList;
        for (const white of whiteList){
          const whiteExpr = this.convert2GlobsRegExp(white);
          if (whiteExpr.test(url)){
            return true;
          }
        }
    
        return false;
      }
    
      blackListCheck(userscript: STUserscriptBean, url: string){
        const blackList = userscript.blackList;
        for (const black of blackList){
          const blackExpr = this.convert2GlobsRegExp(black);
          if (blackExpr.test(url)){
            return true;
          }
        }
    
        return false;
      }
    
      name(): string {
        return "extensions/stay"
      }
    
      version(): string {
        return "0.1";
      }
}
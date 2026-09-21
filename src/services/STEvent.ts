import { getContext } from "./Context";
import { STUserManager } from "./STUserManager";
export enum STEventType {
    SyncPullTask = 'stay.syncPullTask',
    UserDidLogin = 'stay.userDidLogin',
    ReloadUserHead = 'stay.reloadUserHead',
    OptionsPageActivated = 'stay.optionsPageActivated',
    HasNewUserscriptVersion = 'stay.hasNewUserscriptVersion',
    ReloadRemoteSync = 'stay.reloadRemoteSync'
}

export class STEvent {
    private static instance: STEvent;
    public static get(): STEvent {
        if (!STEvent.instance) {
            STEvent.instance = new STEvent();
        }
        return STEvent.instance;
    }

    constructor(){
        getContext().browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
            console.log("STEvent onMessage", message, sender, sendResponse);
            const {operate, origin} = message;
            if (origin === "background"){
                if (operate === "event/post"){
                    const {type, data, targetUrl} = message;
                    if (targetUrl === window.location.href){
                        console.log("event/post=======", type, data, targetUrl, window.location.href);
                        if (type === STEventType.UserDidLogin){
                            STUserManager.get().reloadUserFromDisk().then(() => {
                                window.dispatchEvent(new CustomEvent(type, {
                                    detail: data
                                }));
                            })
                        }
                        else{
                            window.dispatchEvent(new CustomEvent(type, {
                                detail: data
                            }));
                        }
                    }
                }
            }
            return true;
        })
    }

    public observe(type: STEventType, callback: (data: any) => void){
        window.addEventListener(type, (event: any) => {
            callback(event.detail);
        });
    }

    public post(type: STEventType, data?: any){
        window.dispatchEvent(new CustomEvent(type, {
            detail: data
        }));

        getContext().browser.runtime.sendMessage({
            operate: "event/post",
            type: type,
            data: data
        });
    }
}
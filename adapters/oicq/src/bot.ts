import {Client, EventMap, Quotable, Sendable,Config as ClientConfig,MessageRet} from "oicq";
import {App,Adapter,Bot,ChannelId, Filter, NSession, Session,Plugin} from "oitq";
import {merge} from "@oitq/utils";
export class OicqBot extends Client implements Bot<OicqBot.Config>{
    options: OicqBot.Config
    admins:number[]=[]
    public platform: 'oicq';
    public plugin: Plugin;
    public sid: string;
    master:number
    public app:App
    constructor(public adapter:Adapter, config:OicqBot.Config) {
        super(config.uin,merge(OicqBot,config).config);
        this.app=adapter.app
        config=merge(OicqBot.DefaultConfig,config)
        this.plugin=adapter.plugin
        this.sid=String(config.uin)
        this.options = config
        this.admins=config.admins||[]
        this.master=config.master||null
    }
    start(){
        this.login(this.options.password)
    }
    stop(){
        this.logout()
    }
    isMaster(user_id:number){
        return this.options.master===user_id
    }
    isAdmin(user_id:number){
        return this.options.admins.includes(user_id)
    }



    // 重写emit，将event data封装成session，上报到app
    emit<E extends keyof EventMap>(name: E, ...args: Parameters<EventMap[E]>) {
        const session=this.createSession(name,...args)
        if(name==='message'){
            this.adapter.app.parallel('before-attach',session).finally(()=>{
                this.adapter.app.emit(`bot.${name}`,session)
            })
        }else {
            this.adapter.app.emit(`bot.${name}`,session)
        }
        this.adapter.app.emit(name,...args)
        return super.emit(name, ...args)
    }

    createSession<E extends keyof EventMap>(name: E, ...args: Parameters<EventMap[E]>) {
        let data: any = typeof args[0] === "object" ? args.shift() : {}
        if (!data) data = {}
        data.args = args
        return new Session(this.app, this, data,name) as unknown as NSession<E>
    }
    waitMessage(filter:Filter,timout=this.app.config.delay.prompt):Promise<NSession|void>{
        return new Promise<NSession|void>((resolve => {
            const dispose=this.app.middleware(async (session)=>{
                if(session.event_name!=='message'|| !filter(session as NSession))return
                else{
                    dispose()
                    resolve(session as NSession)
                }
                setTimeout(()=>{
                    resolve(null)
                    dispose()
                },timout)
            })
        }))
    }

    /**
     * 获取登录信息
     */
    getLoginInfo(){
        return {
            user_id:this.uin,
            nickname:this.nickname
        }
    }
    getCredentials(domain:string){
        return {
            cookies:this.cookies[domain],
            csrf_token:this.getCsrfToken()
        }
    }
    getStatus(){
        return {
            online:this.status===11,
            good:true
        }
    }
    /**
     * 发送消息
     * @param channelId 通道id
     * @param content 消息内容，如果为CQ码会自动转换
     * @param source 引用的消息，为string时代表消息id
     */
    async sendMsg(channelId: ChannelId, content: Sendable, source?: Quotable | string): Promise<MessageRet> {
        if (typeof source === 'string') source = await this.getMsg(source) as Quotable
        const [type, id] = channelId.split(':')
        switch (type) {
            case "discuss":
                return this.pickDiscuss(Number(id)).sendMsg(content)
            case 'group':
                if (!this.gl.get(Number(id))) throw new Error(`我没有加入群:${id}`)
                return this.pickGroup(Number(id)).sendMsg(content, source)
            case 'private':
                if (!this.fl.get(Number(id))) throw new Error(`我没有添加用户:${id}`)
                return this.pickFriend(Number(id)).sendMsg(content, source)
        }
        throw new Error('无效的通道Id')
    }
    async broadcast(channelIds:(ChannelId|number)[],message:Sendable){
        const result=[]
        for(const channelId of channelIds){
            if(typeof channelId==="number")result.push(await this.sendPrivateMsg(channelId,message))
            else result.push(await this.sendMsg(channelId,message))
        }
        return result
    }


}
export namespace OicqBot{
    export const DefaultConfig:Config={
        platform: 'oicq',
        admins:[],
        config:{
            data_dir:process.cwd()+'/data',
        },
        master:1659488338
    }
    export interface Config extends Bot.BaseConfig{
        platform:'oicq'
        uin?: number
        config?: ClientConfig,
        password?:string
        master?: number // 当前机器人主人
        admins?: number[] // 当前机器人管理员
    }
}

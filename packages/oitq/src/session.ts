import {App, Bot, ChannelId, Middleware, NSession, Prompt} from "./index";
import {MessageElem, Sendable} from "oicq";
import {MessageRet} from "oicq/lib/events";
import {toCqcode, template, Awaitable, Dict, fromCqcode,s} from "@oitq/utils";
import {Argv} from "@lc-cn/command";

export interface Session {
    self_id?: number
    message_type?: string
    cqCode?: string
    message?: MessageElem[]
    post_type?: string
    notice_type?: string
    request_type?: string
    user_id?: number
    group_id?: number
    discuss_id?: number
    sub_type?: string

    reply?(content: Sendable, quote?: boolean): Promise<MessageRet>
}

export type Computed<T> = T | ((session: NSession<'message'>) => T)

export interface Parsed {
    content: string
    prefix: string
    appel: boolean
}

export interface SuggestOptions {
    target: string
    items: string[]
    prefix?: string
    suffix: string
    minSimilarity?: number
    apply: (this: NSession<'message'>, suggestion: string) => Awaitable<void | string>
}

export class Session {
    argv: Argv
    parsed?: Parsed

    constructor(public app: App, public bot: Bot, data: Dict) {
        Object.assign(this, data)
        if (data.message) {
            this.cqCode = toCqcode(data)
        }
        if(data.reply){
            this.reply=(content,source)=>{
                const msgList=[].concat(content).map(msg=>typeof msg==='string'?fromCqcode(msg):msg)
                return data.reply(msgList.flat(1),source)
            }
        }
    }

    middleware(middleware: Middleware) {
        const channelId = this.getFromUrl()
        return this.bot.middleware(session => {
            if (session.getFromUrl() !== channelId) return
            middleware(session);
            return true
        }, true)
    }

    private promptReal<T extends keyof Prompt.TypeKV>(prev: any, answer: Dict, options: Prompt.Options<T>): Promise<Prompt.ValueType<T> | void> {
        if (typeof options.type === 'function') options.type = options.type(prev, answer, options)
        if (!options.type) return
        if (['select', 'multipleSelect'].includes(options.type as keyof Prompt.TypeKV) && !options.choices) throw new Error('choices is required')
        return new Promise<Prompt.ValueType<T> | void>(resolve => {
            this.reply(Prompt.formatOutput(prev, answer, options))
            const dispose = this.middleware((session) => {
                const cb=()=>{
                    let result = Prompt.formatValue(prev, answer, options, session.message)
                    dispose()
                    resolve(result)
                    clearTimeout(timer)
                }
                if (!options.validate) {
                    cb()
                } else {
                    if(typeof options.validate!=="function"){
                        options.validate=(str:string)=>(options.validate as RegExp).test(str)
                    }
                    try{
                        let result=options.validate(session.cqCode)
                        if(result && typeof result==="boolean") cb()
                        else this.reply(options.errorMsg)
                    }catch (e){
                        this.reply(e.message)
                    }
                }
            })
            const timer = setTimeout(() => {
                dispose()
                resolve()
            }, options.timeout || this.app.config.delay.prompt)
        })
    }

    async prompt<T extends keyof Prompt.TypeKV>(options: Prompt.Options<T> | Array<Prompt.Options<T>>) {
        options = [].concat(options)
        let answer: Dict = {}
        let prev: any = undefined
        try {
            if (options.length === 0) return
            for (const option of options) {
                if (typeof option.type === 'function') option.type = option.type(prev, answer, option)
                if (!option.type) continue
                if (!option.name) throw new Error('name is required')
                prev = await this.promptReal(prev, answer, option)
                answer[option.name] = prev
            }
        } catch (e) {
            this.reply(e.message)
            return
        }
        return answer as Prompt.Answers<Prompt.ValueType<T>>
    }

    private prefixInters(argv: Argv) {
        if (!argv.tokens) return
        for (const token of argv.tokens) {
            let {content} = token
            for (const inter of token.inters) {
                const contentArr = content.split('')
                contentArr.splice(inter.pos, 0, inter.initiator, inter.source, inter.initiator ? ')' : '')
                content = contentArr.join('')
            }
            token.content = content
        }
    }
    async executeTemplate(template:string){
        const session:NSession<'message'>=this as any
        template=template.replace(/\$A/g, s('at', { type: 'all' }))
            .replace(/\$a/g, s('at', { id: session.user_id }))
            .replace(/\$m/g, s('at', { id: session.bot.uin }))
            .replace(/\$s/g, () => session.sender['card']||session.sender['title']||session.sender.nickname)
        while (template.match(/\$\(.*\)/)){
            const text = /\$\((.*)\)/.exec(template)[1]
            const executeResult = await this.executeTemplate(text)
            if(typeof executeResult==='string')
                template = template.replace(/\$\((.*)\)/, executeResult)
        }
        const result=await this.execute(template, false) as Sendable
        return result?result:template
    }
    execute(content: string = this.cqCode, autoReply = true):Awaitable<boolean|Sendable|void> {
        for (const [, command] of this.app._commands) {
            const argv = Argv.parse(content)
            argv.bot = this.bot
            argv.session = this as any
            this.prefixInters(argv)
            if(!command.match(this as any))continue
            let result
            try{
                result = command.execute(argv)
                if (autoReply && typeof result === 'string'){
                    this.bot.sendMsg(this.getChannelId(),result)
                    return
                }
            }catch{}
            if (result) return result
        }
    }
    getChannelId():ChannelId{
        return [
            this.message_type,
            this.notice_type,
            this.request_type,
        ].filter(Boolean).join('.') + ':' + [
            this.group_id||this.discuss_id||this.user_id,
        ].filter(Boolean).join('.') as ChannelId
    }
    getFromUrl() {
        return [
            this.post_type,
            this.message_type,
            this.notice_type,
            this.request_type,
            this.sub_type,
        ].filter(Boolean).join('.') + ':' + [
            this.group_id,
            this.discuss_id,
            this.user_id
        ].filter(Boolean).join('.')
    }

    resolveValue<T>(source: T | ((session: Session) => T)): T {
        return typeof source === 'function' ? Reflect.apply(source, null, [this]) : source
    }

    text(path: string | string[], params: object = {}) {
        return template(path, params)
    }

    toJSON(...besides:string[]) {
        return Object.fromEntries(Object.entries(this).filter(([key, value]) => {
            return !['app', 'bot'].includes(key) && !key.startsWith('_') && !besides.includes(key)
        }))
    }
}

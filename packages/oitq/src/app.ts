import * as path from "path";
import * as fs from 'fs'
import {Logger, getLogger} from "log4js";
import {LogLevel, Middleware, NSession} from "./types";
import ConfigLoader from "./configLoader";
import {deepClone, deepMerge} from "./utils";
import {Event} from "./event";
import {Plugin} from "./plugin";
import {Adapter, BotEventMap} from "./adapter";
import {Service} from "./service";
import {Command} from "./command";
import {Argv} from "./argv";
import {ChildProcess, fork} from 'child_process'
import {join, resolve} from "path";

declare global {
    var __OITQ__: App
}

export class App extends Event {
    public config: App.Config
    public started: boolean
    public services: Record<string, Service>
    public adapters: Record<string, Adapter>
    public plugins: Record<string, Plugin>
    middlewares: Middleware[] = []
    public logger: Logger

    constructor(config: App.Config) {
        super()
        this.plugins = {}
        this.services = {}
        this.adapters = {}
        this.config = deepMerge(deepClone(App.defaultConfig), config)
        this.logger = getLogger(`[Oitq]`)
        this.logger.level = this.config.logLevel;
        this.on('message', async (session: NSession<BotEventMap, App.MessageEvent>) => {
            for (const middleware of this.middlewares) {
                let result = await middleware(session)
                if (result) {
                    if (typeof result !== 'boolean') {
                        session.sendMsg(result)
                    }
                    return
                }
            }
        })
    }

    get commandList(): Command[] {
        return Object.values(this.plugins).map(plugin => plugin.commandList).flat()
    }

    get bots() {
        return Object.values(this.adapters).map(adapter => adapter.bots).flat()
    }

    findPlugin(filter: (plugin: Plugin) => boolean) {
        return Object.values(this.plugins).find(filter)
    }

    findAdapter(filter: (plugin: Adapter) => boolean) {
        return Object.values(this.adapters).find(filter)
    }

    findService(filter: (plugin: Service) => boolean) {
        return Object.values(this.services).find(filter)
    }

    dispose() {
        this.emit('dispose')
        for (const plugin of Object.values(this.plugins)) {
            plugin.dispose()
        }
        this.started = false
    }

    findCommand(argv: Argv) {
        return this.commandList.find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test(argv.source))
        })
    }

    getLogger(category: string) {
        const logger = getLogger(`[Oitq:${category}]`)
        logger.level = this.config.logLevel
        return logger
    }

    use(middleware: Middleware, prepend?: boolean): this {
        const method = prepend ? 'shift' : 'push'
        this.middlewares[method](middleware)
        return this
    }

    init() {
        this.initServices()
        this.initAdapters()
        this.initPlugins()
    }

    private initServices() {
        for (let name of Object.keys(this.config.services)) {
            this.load(name, 'service')
        }
    }

    public dispatch(event, ...args: any[]) {
        for (const service of Object.values(this.services)) {
            service.emit(event, ...args)
        }
        for (const plugin of Object.values(this.plugins)) {
            plugin.emit(event, ...args)
        }
        for (const adapter of Object.values(this.adapters)) {
            adapter.emit(event, ...args)
        }
    }

    private initAdapters() {
        for (let name of Object.keys(this.config.adapters)) {
            this.load(name, 'adapter')
        }
    }

    private initPlugins() {
        for (let name of Object.keys(this.config.plugins)) {
            this.load(name, 'plugin')
        }
    }

    public load(name: string, type: 'service' | 'plugin' | 'adapter') {
        let resolved
        const orgModule = `@oitq/${type}-${name}`
        const comModule = `oitq-${type}-${name}`
        const builtModule = path.join(__dirname, `${type}s`, name)
        let customModule
        if (this.config[`${type}_dir`]) customModule = path.resolve(this.config[`${type}_dir`], name)
        if (customModule) {
            try {
                require.resolve(customModule)
                resolved = customModule
            } catch {
            }
        }
        if (!resolved) {
            try {
                require.resolve(builtModule)
                resolved = `${__dirname}/${type}s/${name}`
            } catch {
            }
        }
        if (!resolved) {
            try {
                require.resolve(orgModule)
                resolved = `@oitq/${type}-${name}`
            } catch {
            }
        }
        if (!resolved) {
            try {
                require.resolve(comModule)
                resolved = `oitq-${type}-${name}`
            } catch {
            }
        }

        if (!resolved) throw new Error(`未找到${type}(${name})`)
        require(resolved)
    }
    unload(name: string, type: 'service' | 'plugin' | 'adapter'){
        const item=this[`${type}s`][name]
        if(item) {
            item.dispose()
            item.emit('dispose')
            item.dependencies.forEach(filePath=>{
                delete require.cache[filePath]
            })
        }
    }
    async start() {
        this.init()
        App.metaEvent.forEach(metaEvent => {
            this.on(metaEvent, (...args) => this.dispatch(metaEvent, ...args))
        })
        for (const [name, service] of Object.entries(this.services)) {
            service.emit('start')
            this.logger.info(`service(${name}) 已启动`)
        }
        for (const [name, adapter] of Object.entries(this.adapters)) {
            adapter.emit('start')
            this.logger.info(`adapter(${name}) 已启动`)
        }
        for (const [name, plugin] of Object.entries(this.plugins)) {
            plugin.emit('start')
            this.logger.info(`plugin(${name}) 已启动`)
        }
        this.started = true
        this.emit('start')
    }
}

export function start(config: App.Config | string = path.join(process.cwd(), 'oitq.yaml')) {
    if (typeof config === 'string') return App.start(config)
    const configPath = App.writeConfig(config)
    console.log('已将配置保存到' + configPath)
    App.start(configPath)
}

export function defineConfig(config: App.Config) {
    return config
}

export namespace App {
    export type MessageEvent = 'oicq.message'
    const event=['bot','command','plugin']
        .map(type=>['add','remove']
            .map(event=>`${type}-${event}`))
        .flat()
    const lifeCycle=['plugin','service','adapter']
        .map(type=>['start','dispose']
            .map(event=>`${type}.${event}`))
        .flat()
    export const metaEvent =event.concat(lifeCycle)

    export function start(configPath: string) {
        return createWorker(configPath)
    }

    export interface Config<S extends keyof Service.Config=keyof Service.Config,P extends keyof Plugin.Config=keyof Plugin.Config,A extends keyof Adapter.Config=keyof Adapter.Config> {
        services?: Partial<Record<S, Service.Config[S]>>
        plugins?: Partial<Record<P, Plugin.Config[P]>>
        adapters?: Partial<Record<A, Adapter.Config[A]>>
        plugin_dir?: string
        service_dir?: string
        adapter_dir?: string
        logLevel?: LogLevel
    }

    export const defaultConfig: Config = {
        logLevel: 'info',
        services: {},
        plugins: {
            commandParser: true,
        },
        adapters: {}
    }

    export function readConfig(dir = join(process.cwd(), 'oitq.yaml')) {
        if (!fs.existsSync(dir)) {
            fs.writeFileSync(dir, JSON.stringify(defaultConfig), 'utf-8')
            console.log('未找到配置文件，已创建默认配置文件，请修改后重新启动')
            process.exit()
        }
        return deepMerge(deepClone(defaultConfig),new ConfigLoader<App.Config>(dir).readConfig())
    }

    export function writeConfig(config: App.Config, dir = join(process.cwd(), 'oitq.yaml')) {
        fs.writeFileSync(dir, JSON.stringify(config), 'utf-8')
        return dir
    }
}
let cp: ChildProcess
process.on('SIGINT', () => {
    if (cp) {
        cp.emit('SIGINT')
    } else {
        process.exit()
    }
})

interface Message {
    type: 'start' | 'queue'
    body: any
}

let buffer = null

export function createWorker(configPath) {
    cp = fork(resolve(__dirname, 'worker'), [], {
        env: {
            configPath
        },
        execArgv: [
            '-r', 'esbuild-register',
            '-r', 'tsconfig-paths/register'
        ]
    })
    let config: { autoRestart: boolean }
    cp.on('message', (message: Message) => {
        if (message.type === 'start') {
            config = message.body
            if (buffer) {
                cp.send({type: 'send', body: buffer})
                buffer = null
            }
        } else if (message.type === 'queue') {
            buffer = message.body
        }
    })
    const closingCode = [0, 130, 137]

    cp.on('exit', (code) => {
        if (!config || closingCode.includes(code) || code !== 51 && !config.autoRestart) {
            process.exit(code)
        }
        createWorker(configPath)
    })
}


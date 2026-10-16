import { TokenStore } from 'xal-node'
import Store from 'electron-store'
import { safeStorage } from 'electron'

export interface TokenStoreLoadResult {
    status:'empty' | 'encrypted' | 'migrated' | 'error';
    error?:string;
}

export default class AuthTokenStore extends TokenStore {

    private _store = new Store()
    private readonly _encryptedKey = 'user.tokenstoreEncrypted'
    private readonly _legacyKey = 'user.tokenstore'
    private _lastLoadResult:TokenStoreLoadResult = {status: 'empty'}

    load():boolean {
        try {
            const encryptedTokens = this._store.get(this._encryptedKey) as string | undefined
            if(encryptedTokens){
                if(!safeStorage.isEncryptionAvailable())
                    throw new Error('Windows credential protection is unavailable.')
                const tokens = safeStorage.decryptString(Buffer.from(encryptedTokens, 'base64'))
                this.loadJson(tokens)
                this._lastLoadResult = {status: 'encrypted'}
                return true
            }

            const legacyTokens = this._store.get(this._legacyKey) as string | undefined
            if(legacyTokens && legacyTokens !== '{}'){
                this.loadJson(legacyTokens)
                this.save()
                this._lastLoadResult = {status: 'migrated'}
                return true
            }

            this._lastLoadResult = {status: 'empty'}
            return true
        } catch(error) {
            this._userToken = undefined
            this._sisuToken = undefined
            this._jwtKeys = undefined
            this._lastLoadResult = {status: 'error', error: error instanceof Error ? error.message : String(error)}
            return false
        }
    }

    save() {
        if(!safeStorage.isEncryptionAvailable())
            throw new Error('Cannot save Microsoft sign-in securely because Windows credential protection is unavailable.')

        const data = JSON.stringify({
            userToken: this._userToken?.data,
            sisuToken: this._sisuToken?.data,
            jwtKeys: this._jwtKeys,
        })

        const encryptedTokens = safeStorage.encryptString(data).toString('base64')
        this._store.set(this._encryptedKey, encryptedTokens)
        this._store.delete(this._legacyKey)
    }

    clear() {
        this._store.delete(this._encryptedKey)
        this._store.delete(this._legacyKey)
        this._userToken = undefined
        this._sisuToken = undefined
        this._jwtKeys = undefined
    }

    removeAll() {
        this._userToken = undefined
        this._sisuToken = undefined

        this._store.delete(this._encryptedKey)
        this._store.delete(this._legacyKey)
    }

    isProtectionAvailable(){
        return safeStorage.isEncryptionAvailable()
    }

    getLastLoadResult(){
        return this._lastLoadResult
    }
}

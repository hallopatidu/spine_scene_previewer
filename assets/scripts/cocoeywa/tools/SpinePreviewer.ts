import { __private, _decorator, AnimationClip, assetManager, Component, director, error, log, Node, sp, TweenSystem } from 'cc';
import { EDITOR } from 'cc/env';
import { AssetInfo } from '../../@cocos/creator-types/editor/packages/asset-db/@types/public';
const { ccclass, property , executeInEditMode, requireComponent, disallowMultiple} = _decorator;

type RedefinedSkeletonType = sp.Skeleton & {
    _cacheMode:typeof sp.Skeleton.AnimationCacheMode,
    _curFrame:__private._cocos_spine_skeleton_cache__AnimationFrame,
    _animCache:__private._cocos_spine_skeleton_cache__AnimationCache,
    _isAniComplete:boolean,
    _animationQueue:__private._cocos_spine_skeleton__AnimationItem[],
    _headAniInfo:__private._cocos_spine_skeleton__AnimationItem,
    _accTime:number,
    _instance: sp.spine.SkeletonInstance,
    _updateCache:(dt:number)=>void,
    markForUpdateRenderData:(enable?:boolean)=>void
}

const EditorMode = {
    Prefab:'prefab',
    Animation:'animation',
    General:'general'
}

const DefaultAnimationClipData = {
    __type__: "cc.AnimationClip",
    _name: "",
    _objFlags: 0,
    _native: "",
    sample: 60,
    speed: 1,
    wrapMode: 1,
    events: [],
    _duration: 50,
    _keys: [],
    _stepness: 0,
    curveDatas: {},
    _curves: [],
    _commonTargets: [],
    _hash: 0
}

@ccclass('SpinePreviewer')
@disallowMultiple(true)
@requireComponent(sp.Skeleton)
@executeInEditMode(true)
export class SpinePreviewer extends Component {
    private static __runningPreviewerUuid: string = null
    private static get isAnimationMode(): boolean {
        if (EDITOR) {
            const currentMode: string = Editor.EditMode.getMode();
            return currentMode == EditorMode.Animation;
        }
        return false;
    }

    @property({ type: sp.Skeleton })
    public get spine(): sp.Skeleton {
        return this._spine;
    }
    public set spine(value: sp.Skeleton) {
        if (this._spine === value) return;
        this._spine = value;
        if(value){
            if (!SpinePreviewer.isAnimationMode) {
                if (value && value.skeletonData) {
                    const skeletonData: sp.SkeletonData = value.skeletonData;
                    const uuid: string = skeletonData.uuid;
                    this.referenceAnimationAsset(uuid);
                } else if (value && !value.skeletonData) {
                    error('Reference to Spine Component fail. You need SkeletonData Asset for this Spine Component !')
                } else {
                    this.defaultClip = null;
                }
            }
        }
    }

    @property({
        type: AnimationClip,
        visible: false,
        override: true
    })
    get defaultClip(): AnimationClip {
        return this._defaultClip
    }
    set defaultClip(value: AnimationClip) {
        this._defaultClip = value;
    }

    @property({
        visible() {
            return this._spine;
        }
    })
    public get playInEditor(): boolean {
        if (EDITOR) {
            const currentMode:string = Editor.EditMode.getMode()
            this._playInEditor = (currentMode == EditorMode.Animation ) && this.curentAnimationIsARunningAnimation
        }
        return this._playInEditor;
    }

    public set playInEditor(value: boolean) {
        if (EDITOR) {
            if (value) {
                this.playAnimation();
            } else if (!value && this.curentAnimationIsARunningAnimation) {
                this.stopAnimation();
            }
            this._playInEditor = value;
        }    
    }

    private get curentAnimationIsARunningAnimation():boolean{
        return this.defaultClip ? SpinePreviewer.__runningPreviewerUuid == this.defaultClip.uuid : false
    }

    // ---------    
    private _spine: sp.Skeleton = null;
    private _playInEditor: boolean = false;

    @property({serializable:true, visible:true})
    protected _defaultClip: AnimationClip | null;
    
    
    // --------

    protected onLoad(): void {
        if(!this.spine){
            this.spine = this.getComponent(sp.Skeleton);
        }
    }

    update(deltaTime: number) {
        if (this.playInEditor) {
            this.updateSpineAnimation(deltaTime);
            // // SkeletonSystem
            // director.getSystem('SKELETON').postUpdate(deltaTime)
            TweenSystem.instance.ActionManager.update(deltaTime);
            Editor.Message.request('scene', 'set-edit-time', deltaTime)
        }
    }

    // ------------ Feature Function ----------------

    protected async playAnimation():Promise<void> {
        if (EDITOR) {
            if(SpinePreviewer.__runningPreviewerUuid){
                await this.stopAnimation();
            }
            const currentClip: AnimationClip = this.defaultClip;
            if(!currentClip) return
            const clipUUID:string = currentClip.uuid;
            const selectedNodeUuid: string = this.node.uuid
            SpinePreviewer.__runningPreviewerUuid = clipUUID //this.uuid;
            await Editor.Message.request('scene', 'record-animation', selectedNodeUuid, true, clipUUID);            
            await Editor.Message.request('scene', 'query-node', selectedNodeUuid);
        }
    }

    protected async stopAnimation():Promise<void> {
        if(EDITOR){            
            const checkMode: string = Editor.EditMode.getMode();
            if (checkMode == EditorMode.Animation) {
                const clipUUID:string = SpinePreviewer.__runningPreviewerUuid;
                if(clipUUID){
                    await Editor.Message.request('scene', 'change-clip-state', 'stop', clipUUID);
                }
                await Editor.Message.request('scene', "close-scene");
                SpinePreviewer.__runningPreviewerUuid = null;
                // 
                // const currentClip: AnimationClip = this.defaultClip;
                // if (currentClip) {
                //     await Editor.Message.request('scene', 'change-clip-state', 'stop', currentClip.uuid);
                // }
                // await Editor.Message.request('scene', "close-scene")
                // SpinePreviewer.__runningPreviewerUuid = null;
            }
        }
    }

    /**
     * Loads an animation clip asset by its UUID.
     * This method asynchronously retrieves an animation clip from the asset manager using the provided UUID.
     * 
     * @param uuid - The UUID of the animation clip asset to load
     * @returns A promise that resolves with the loaded AnimationClip if successful, or null if the load operation fails
     * @remarks
     * - If an error occurs during asset loading, it will be logged to the console and null will be returned
     * - This method uses the asset manager's loadAny function to load the asset as an AnimationClip type
     * 
     * @example
     * ```typescript
     * const clip = await this.loadAnimationClipByUuid('some-uuid-string');
     * if (clip) {
     *   // Use the animation clip
     * }
     * ```
     */
    private async loadAnimationClipByUuid(uuid: string): Promise<AnimationClip | null> {
        return new Promise<AnimationClip | null>((resolve, reject) => {
            assetManager.loadAny({ uuid: uuid }, (err, asset) => {
                if (err) {
                    console.error('Failed to load asset:', err);
                    resolve(null);
                    return;
                }
                resolve(asset as AnimationClip);
            });
        })
    }

    /**
     * References an animation asset and creates it if it doesn't exist.
     * This method queries the asset database for an animation file corresponding to the target asset,
     * creates a new animation asset if it doesn't exist, loads the animation clip, and adds it to the previewer.
     * After creating a new asset, it triggers a soft reload of the scene.
     * 
     * @param targetAssetUuid - The UUID of the target asset to reference the animation from
     * @returns A promise that resolves when the animation asset has been referenced and loaded
     * @throws May reject if the asset database operations fail
     * 
     * @remarks
     * - This method only executes in the editor environment (EDITOR context)
     * - If the animation asset already exists, it will be loaded and added to the previewer
     * - If the animation asset doesn't exist, it will be created with default animation clip data
     * - After asset creation, a scene soft-reload is triggered to reflect changes
     * - The animation clip is set as the default clip for the previewer
     */
    private async referenceAnimationAsset(targetAssetUuid: string): Promise<void> {
        if (EDITOR) {
            const uuid: string = targetAssetUuid
            const url: string = await Editor.Message.request('asset-db', "query-url", uuid);
            const relativePath: string = this.getPathWithoutFileName(url);
            const animAssetName: string = this.getFilenameWithoutExtension(url);
            const animAssetUrl: string = relativePath + animAssetName + '.anim';
            // 
            let isNewAsset: boolean = false;
            let assetInfo: AssetInfo = await Editor.Message.request('asset-db', 'query-asset-info', animAssetUrl);
            if (!assetInfo) {
                assetInfo = await Editor.Message.request('asset-db', 'create-asset', animAssetUrl, JSON.stringify(DefaultAnimationClipData));
                await Editor.Message.request('asset-db', 'refresh-asset', assetInfo.uuid);
                isNewAsset = true;
            }
            // 
            const animationClip: AnimationClip = await this.loadAnimationClipByUuid(assetInfo.uuid);
            if (animationClip) {
                this.defaultClip = animationClip;
                isNewAsset && await Editor.Message.request('scene', 'soft-reload');
            }
        }
    }

    /**
     * Update skeleton animation.
     * @param dt delta time.
     */
    public updateSpineAnimation(dt: number): void {
        if (!this.spine) return;
        const spine: RedefinedSkeletonType = this.spine as RedefinedSkeletonType;
        spine.markForUpdateRenderData();
        if (spine.paused) return;
        dt *= spine.timeScale * 1;
        // 
        if (spine._cacheMode !== sp.Skeleton.AnimationCacheMode.REALTIME) {
            if (spine._isAniComplete) {
                if (spine._animationQueue.length === 0 && !spine._headAniInfo) {
                    const frameCache = spine._animCache;
                    if (frameCache && frameCache.isInvalid()) {
                        frameCache.updateToFrame(0);
                        const frames = frameCache.frames;
                        spine._curFrame = frames[frames.length - 1];
                    }
                    return;
                }
                if (!spine._headAniInfo) {
                    spine._headAniInfo = spine._animationQueue.shift()!;
                }
                spine._accTime += dt;
                if (spine._accTime > spine._headAniInfo?.delay) {
                    const aniInfo = spine._headAniInfo;
                    spine._headAniInfo = null;
                    spine.setAnimation(0, aniInfo?.animationName, aniInfo?.loop);
                }
                return;
            }
            spine._updateCache(dt);
        } else {
            spine._instance! && spine._instance!.updateAnimation(dt);
        }
    }

    // --------- Support -----------

    private getPathWithoutFileName(fullUrl: string): string | null {
        const match = fullUrl.match(/^([a-zA-Z]+:\/\/.+\/)[^\/]+\.[^\/]+$/);
        return match ? match[1] : null;
    }

    private getFilenameWithoutExtension(url: string): string {
        const pathname = new URL(url).pathname;
        const match = pathname.match(/\/([^\/]+?)(?:\.[^\/.]+)?$/);
        return match ? match[1] : '';
    }

}



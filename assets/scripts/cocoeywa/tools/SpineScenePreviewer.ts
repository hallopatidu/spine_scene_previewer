import { __private, _decorator, Animation, AnimationClip, assetManager, Component, error, log, Node, sp, warn } from 'cc';
import { EDITOR } from 'cc/env';
import { AssetInfo } from '../../@cocos/creator-types/editor/packages/asset-db/@types/public';
const { ccclass, property, executeInEditMode } = _decorator;

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

const DefaulAnimTemplate = "db://internal/default_file_content/animation-clip/default.anim";

@ccclass('SpineScenePreviewer')
@executeInEditMode(true)
export class SpineScenePreviewer extends Animation {

    private static __runningPreviewerUuid: string = null

    private static get isInAnimationMode(): boolean {
        if (EDITOR) {
            const currentMode: string = Editor.EditMode.getMode();
            return currentMode == EditorMode.Animation;
        }
        return false;
    }

    private _spine: sp.Skeleton;
    private _seekTime: number = 0;
    private _previewTrackIndex: number = 0;

    private _previewUUID:string = null;
    private get previewUUID():string{
        if(!this._previewUUID){
            this._previewUUID = `${this.node?.uuid}::${this.uuid}`
        }
        return this._previewUUID
    }

    private get isInPreviewFocus():boolean{
        return SpineScenePreviewer.__runningPreviewerUuid == this.previewUUID && SpineScenePreviewer.isInAnimationMode;
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
        type: sp.Skeleton,
        visible:true,        
    })
    public get spine(): sp.Skeleton {
        return this._spine;
    }
    public set spine(value: sp.Skeleton) {
        this._spine = value;        
        if(EDITOR){
            const skeletonData: sp.SkeletonData = this._spine?.skeletonData;
            if(skeletonData){
                const uuid: string = skeletonData.uuid;
                this.referenceAnimationAsset(uuid);
            }
        }
    }

    @property({
        slide: true,        
        range: [0, 100],
        visible() {
            return !this.playInEditor;
        }
    })    
    public get seekTime(): number {
        return this._seekTime;
    }
    public set seekTime(value: number) {
        this._seekTime = value;
        this.seekTo(value);
    }

    onLoad(): void {
        super.onLoad && super.onLoad();
        if(!this.spine){
            this.spine = this.getComponent(sp.Skeleton);
        }

    }
    
    start() {
        if(EDITOR){
            const skeletonData: sp.SkeletonData = this.spine?.skeletonData;
            if(skeletonData){
                const uuid: string = skeletonData.uuid;
                this.referenceAnimationAsset(uuid);
            }
        }
    }

    update(deltaTime: number) {
        log('hellllllllll')
        Editor.Message.request('scene', 'set-edit-time', deltaTime);
    }

    // --------------------

    private async referenceAnimationAsset(targetAssetUuid: string): Promise<void> {
        if (!EDITOR) return;
        try {
            // 1. Lấy thông tin đường dẫn từ UUID 
            // (Retrieve the file path using the source UUID.)
            const url: string = await Editor.Message.request('asset-db', "query-url", targetAssetUuid);
            if (!url) {
                warn(`[ReferenceAnim] Không tìm thấy URL cho UUID: ${targetAssetUuid}`);
                return;
            }
            
            const relativePath: string = this.getPathWithoutFileName(url);
            const animAssetName: string = this.getFilenameWithoutExtension(url);
            const animAssetUrl: string = `${relativePath}${animAssetName}.anim`;

            let assetInfo: AssetInfo = await Editor.Message.request('asset-db', 'query-asset-info', animAssetUrl);
            // 2. Tạo asset mới nếu chưa tồn tại 
            // (Create a new .anim asset if it doesn't already exist.)
            let isNewAsset: boolean = false;
            if (!assetInfo) {
                assetInfo = await Editor.Message.request('asset-db', 'new-asset', {  
                    handler: "animation-clip",
                    target: animAssetUrl,
                    template: DefaulAnimTemplate,
                    overwrite: true
                });
                // const defaultData = JSON.stringify(DefaultAnimationClipData);
                // assetInfo = await Editor.Message.request('asset-db', 'create-asset', animAssetUrl, defaultData);                
                if (assetInfo) {
                    await Editor.Message.request('asset-db', 'refresh-asset', assetInfo.uuid);
                    isNewAsset = true;
                    // log(`[ReferenceAnim] Đã tạo mới Animation Clip: ${animAssetUrl}`);
                } else {
                    throw new Error(`Failed to create asset at: ${animAssetUrl}`);
                }
            }
            
            // 3. Load và gán Animation Clip 
            // (Load and assign the Animation Clip to the component.)
            const animationClip: AnimationClip = await this.loadAnimationClipByUuid(assetInfo.uuid);
            if (animationClip) {
                // Thêm clip vào animation.
                this.addClip(animationClip, assetInfo.name);
                this.defaultClip = animationClip;

                // 4. Nếu file .anim vừa được tạo thì reload nhẹ cái Cocos Creator Editor. 
                // (Perform a soft-reload of the Editor if a new asset was generated.)
                if (isNewAsset) {
                    await Editor.Message.request('scene', 'soft-reload');
                }                
                
            }

        }catch(err){
            error("[SpinePreviewer] Error during Animation Asset referencing:", err);
        }
    }

    /**
     * 
     * @param uuid 
     * @returns 
     */
    private async loadAnimationClipByUuid(uuid: string): Promise<AnimationClip | null> {        
        try {
            return await new Promise<AnimationClip | null>((resolve) => {
                assetManager.loadAny({ uuid }, (err, asset) => {
                    if (err) {
                        error(`[LoadAnim] Lỗi tải asset (UUID: ${uuid}):`, err);
                        return resolve(null);
                    }
                    
                    // Kiểm tra xem asset có thực sự là AnimationClip không
                    if (!(asset instanceof AnimationClip)) {
                        warn(`[LoadAnim] Asset có (UUID: ${uuid}) không phải là AnimationClip.`);
                        return resolve(null);
                    }

                    resolve(asset);
                });
            });
        } catch (e) {
            error(`[LoadAnim] Lỗi hệ thống khi load UUID: ${uuid}`, e);
            return null;
        }
    }

    /**
     * 
     * @param time 
     */
    private async seekTo(time:number){
        if(EDITOR){                        
            this._previewTrackIndex = this.spine.setAnimation(this._previewTrackIndex, this.spine.animation, this.spine.loop).trackIndex;
            this.updateSpineAnimation(time);
            // const selectedNodeUuid: string = this.node.uuid;
            
            // if(this.defaultClip){
            //     const clipUUID:string = this.defaultClip.uuid
            //     await Editor.Message.request('scene', 'record-animation', selectedNodeUuid, true, clipUUID);            
            //     await Editor.Message.request('scene', 'query-node', selectedNodeUuid);
            //     await Editor.Message.request('scene', 'set-edit-time', time);
            //     await Editor.Message.request('scene', 'change-clip-state', 'stop', clipUUID);
            //     await Editor.Message.request('scene', "close-scene")
            // }
        }
    }

    /**
     * Update skeleton animation.
     * @param dt delta time.
     */
    protected updateSpineAnimation(dt: number): void {
        if (!this.spine) return;
        const spine: RedefinedSkeletonType = this.spine as RedefinedSkeletonType;
        spine.markForUpdateRenderData();
        if (spine.paused) return;
        dt *= spine.timeScale * 1;
        // // 
        // if (spine._cacheMode !== sp.Skeleton.AnimationCacheMode.REALTIME) {
        //     if (spine._isAniComplete) {
        //         if (spine._animationQueue.length === 0 && !spine._headAniInfo) {
        //             const frameCache = spine._animCache;
        //             if (frameCache && frameCache.isInvalid()) {
        //                 frameCache.updateToFrame(0);
        //                 const frames = frameCache.frames;
        //                 spine._curFrame = frames[frames.length - 1];
        //             }
        //             return;
        //         }
        //         if (!spine._headAniInfo) {
        //             spine._headAniInfo = spine._animationQueue.shift()!;
        //         }
        //         spine._accTime += dt;
        //         if (spine._accTime > spine._headAniInfo?.delay) {
        //             const aniInfo = spine._headAniInfo;
        //             spine._headAniInfo = null;
        //             spine.setAnimation(0, aniInfo?.animationName, aniInfo?.loop);
        //         }
        //         return;
        //     }
        //     spine._updateCache(dt);
        // } else {
        //     spine._instance! && spine._instance!.updateAnimation(dt);
        // }
        spine._instance! && spine._instance!.updateAnimation(dt);
    }

    // --------- Utils -----------

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



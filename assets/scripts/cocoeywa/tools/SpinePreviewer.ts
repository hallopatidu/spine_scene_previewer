
import { __private, _decorator, Animation, AnimationClip, assetManager, CCClass, Component, director, error, log, Node, sp, TweenSystem, warn } from 'cc';
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

/**
 * SpinePreviewer Component 
 *  ** Cho phép xem trực tiếp chuyển động của spine trên Scene.
 *  ** Cơ chế là chuyển Editor sang Animation Mode để chạy Animation.
 *  ** Quá trình này yêu cầu hệ thống tự động tạo thêm một file .anim giả cùng tên đứng cạnh file spine để chạy.
 *  ** Các phiên bản sau này sẽ sử dụng file .anim này để điều khiển và update việc điều khiển spine.
 * 
 * SpinePreviewer Component
 *  ** Provides live Spine animation previews in the Scene.
 *  ** Mechanism: Switches the Editor to Animation Mode to run animations.
 *  ** Requirement: Automatically creates a dummy .anim file alongside the Spine asset.
 *  ** Roadmap: This file will be used for controlling and updating Spine behaviors in subsequent versions.
 */
@ccclass('SpinePreviewer')
@executeInEditMode(true)
export class SpinePreviewer extends Animation {

    private static __runningPreviewerUuid: string = null

    private static get isInAnimationMode(): boolean {
        if (EDITOR) {
            const currentMode: string = Editor.EditMode.getMode();
            return currentMode == EditorMode.Animation;
        }
        return false;
    }

    @property({ 
        type: sp.Skeleton,
        visible:false,        
    })
    public get spine(): sp.Skeleton {
        return this._spine;
    }
    public set spine(value: sp.Skeleton) {
        if (this._spine === value) return;
        this._spine = value;
        if (!SpinePreviewer.isInAnimationMode) {
            if (value && value.skeletonData) {                
                const skeletonData: sp.SkeletonData = value.skeletonData;
                const uuid: string = skeletonData.uuid;
                this.referenceAnimationAsset(uuid);
                
            } else if (value && !value.skeletonData) {
                error('Reference to Spine Component fail. You need SkeletonData Asset for this Spine Component !')
            } else {
                this.clips.forEach((clip: AnimationClip) => {
                    this.removeClip(clip, true);
                })
                this.defaultClip = null;
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

    @property({
        readonly:true
    })
    duration:number = 0

    // ---------- Hide Animation Component's properties in Editor ------------- 

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

    @property({override:true, visible:false})
    public playOnLoad: boolean;

    @property({ 
        type:[AnimationClip],
        override:true,
        visible:false
    })
    get clips (): (AnimationClip | null)[] {
        return super.clips;
    }

    set clips (value:(AnimationClip | null)[]) {        
        super.clips = value;
    }

    @property({
        visible() {
            return this._spine;
        }
    })
    public get playInEditor(): boolean {
        if (EDITOR) {
            this._isRunning = SpinePreviewer.isInAnimationMode;
        }
        return this._isRunning;
    }

    public set playInEditor(value: boolean) {
        if (EDITOR) {
            if (value) {
                this.playAnimation();
                this._isRunning = value;
            } else if (!value && this.isInPreviewFocus) {
                this.stopAnimation();
            } else {
                return;
            }
        }else{
            this._isRunning = value;
        }
    }

    @property({serializable:true})
    private _spine: sp.Skeleton = null;

    private _previewUUID:string = null;
    private get previewUUID():string{
        if(!this._previewUUID){
            this._previewUUID = `${this.node?.uuid}::${this.uuid}`
        }
        return this._previewUUID
    }

    private get isInPreviewFocus():boolean{
        return SpinePreviewer.__runningPreviewerUuid == this.previewUUID && SpinePreviewer.isInAnimationMode;
    }

    private _isRunning: boolean = false;
    private _previewTrackIndex: number = 0;
    private _seekTime: number = 0;
    private _spineAnimation:string = undefined;
    
    onLoad(): void {
        if(!EDITOR){
            this.destroy();
        }
        super.onLoad();
        if(!this.spine){
            this.spine = this.getComponent(sp.Skeleton);
        }
    }

    update(deltaTime: number) {
        if (this.playInEditor && this.isInPreviewFocus) {
            this.updateSpineAnimation(deltaTime);
            // Nếu muốn tween chạy trên scene thì mở đoạn sau. Lưu ý: các component class sử dụng tween cần có @executeInEditMode(true)
            // TweenSystem.instance.ActionManager.update(deltaTime);    
            Editor.Message.request('scene', 'set-edit-time', deltaTime);            
        }else if(this.hasChanged()){
            this.updateSpineInfo(this.spine);
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
        // 
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

    // ------------- Private ------------

    /**
     * 
     * @param spine 
     */
    private updateSpineInfo(spine:sp.Skeleton){
        if (spine && spine.skeletonData) {       
            this._spineAnimation = this.spine ? this.spine.animation : undefined;     
            const animation:sp.spine.Animation =  spine.findAnimation(this._spineAnimation)
            if(animation){
                const duration:number = animation.duration;
                CCClass.Attr.setClassAttr(this, 'seekTime', 'range', [0, duration]);
                CCClass.Attr.setClassAttr(this, 'seekTime', 'min', 0);
                CCClass.Attr.setClassAttr(this, 'seekTime', 'max', duration);
                CCClass.Attr.setClassAttr(this, 'seekTime', 'step', duration/1000); 
                this.duration = duration;           
            }
        }
    }

    /**
     * 
     * @returns 
     */
    private hasChanged():boolean{
        return this._spineAnimation !== this.spine?.animation
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
     * Tự động tham chiếu hoặc tạo mới Animation Clip dựa trên UUID của tài nguyên mục tiêu.\
     * (Automatically references or creates a new Animation Clip based on the target asset's UUID.)
     * * Process:
     * 1. Retrieve the file path using the source UUID.
     * 2. Create a new .anim asset if it doesn't already exist.
     * 3. Load and assign the Animation Clip to the component.
     * 4. Perform a soft-reload of the Editor if a new asset was generated.
     * @param targetAssetUuid UUID của tài nguyên gốc để xác định đường dẫn. (The UUID of the source asset to determine the path.)
     */
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

            let isNewAsset: boolean = false;
            let assetInfo: AssetInfo = await Editor.Message.request('asset-db', 'query-asset-info', animAssetUrl);

            // 2. Tạo asset mới nếu chưa tồn tại 
            // (Create a new .anim asset if it doesn't already exist.)
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

        } catch (error) {
            error("[SpinePreviewer] Error during Animation Asset referencing:", error);
        }
    }


    private async playAnimation() {
        if (EDITOR) {
            const currentClip: AnimationClip = this.clips[0];
            const selectedNodeUuid: string = this.node.uuid
            SpinePreviewer.__runningPreviewerUuid = this.previewUUID;
            await Editor.Message.request('scene', 'record-animation', selectedNodeUuid, true, currentClip.uuid);            
            await Editor.Message.request('scene', 'query-node', selectedNodeUuid);
        }
    }

    private async stopAnimation(){
        if (EDITOR) {
            const checkMode: string = Editor.EditMode.getMode();                
            if (checkMode == EditorMode.Animation) {
                // 
                const currentClip: AnimationClip = this.clips[0];
                if (currentClip) {
                    Editor.Message.request('scene', 'change-clip-state', 'stop', currentClip.uuid);
                }
                Editor.Message.request('scene', "close-scene")
                SpinePreviewer.__runningPreviewerUuid = null;
            }
        }
    }
    
    private seekTo(time:number){
        if(EDITOR){            
            this._previewTrackIndex = this.spine.setAnimation(this._previewTrackIndex, this.spine.animation, this.spine.loop).trackIndex;
            this.updateSpineAnimation(time);
        }
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




import { __private, _decorator, Animation, AnimationClip, assetManager, Component, director, error, log, Node, sp, TweenSystem, warn } from 'cc';
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


/**
 * SpinePreviewer Component xem trước và xem trực tiếp chuyển động của spine trên Scene.
 * Cơ chế là chuyển Editor sang Animation Mode để chạy Animation.
 * Quá trình này yêu cầu hệ thống tự động tạo thêm một file .anim giả cùng tên đứng cạnh file spine để chạy.
 * Các phiên bản sau này sẽ sử dụng file này để điều khiển và update việc điều khiển spine.
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
            const currentMode: string = Editor.EditMode.getMode();
            if (currentMode == EditorMode.Animation) {
                this._isRunning = true
            }
        }
        return this._isRunning;
    }

    public set playInEditor(value: boolean) {
        if (EDITOR) {
            if (value) {
                this.playAnimation();
            } else if (!value && SpinePreviewer.__runningPreviewerUuid == this.uuid) {

                const checkMode: string = Editor.EditMode.getMode();
                // this.spineState && this.spineState.cancel();
                if (checkMode == EditorMode.Animation) {
                    // 
                    const currentClip: AnimationClip = this.clips[0];
                    if (currentClip) {
                        Editor.Message.request('scene', 'change-clip-state', 'stop', currentClip.uuid);
                    }
                    Editor.Message.request('scene', "close-scene")
                    SpinePreviewer.__runningPreviewerUuid = null;
                }
            } else {
                return;
            }
        }
        this._isRunning = value;
    }

    @property({serializable:true})
    private _spine: sp.Skeleton = null;
    private _isRunning: boolean = false;


    onLoad(): void {
        super.onLoad();
        if(!this.spine){
            this.spine = this.getComponent(sp.Skeleton);
        }
    }

    update(deltaTime: number) {
        if (this.playInEditor && SpinePreviewer.__runningPreviewerUuid == this.uuid) {
            this.updateSpineAnimation(deltaTime);            
            TweenSystem.instance.ActionManager.update(deltaTime);
            Editor.Message.request('scene', 'set-edit-time', deltaTime);            
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
     * Tự động tham chiếu hoặc tạo mới Animation Clip dựa trên UUID của tài nguyên mục tiêu.
     * @param targetAssetUuid UUID của tài nguyên gốc để xác định đường dẫn.
     */
    private async referenceAnimationAsset(targetAssetUuid: string): Promise<void> {
        if (!EDITOR) return;

        try {
            // 1. Lấy thông tin đường dẫn từ UUID
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
            if (!assetInfo) {
                const defaultData = JSON.stringify(DefaultAnimationClipData);
                assetInfo = await Editor.Message.request('asset-db', 'create-asset', animAssetUrl, defaultData);
                
                if (assetInfo) {
                    await Editor.Message.request('asset-db', 'refresh-asset', assetInfo.uuid);
                    isNewAsset = true;
                    // log(`[ReferenceAnim] Đã tạo mới Animation Clip: ${animAssetUrl}`);
                } else {
                    throw new Error(`Không thể tạo asset tại: ${animAssetUrl}`);
                }
            }

            // 3. Load và gán Animation Clip
            const animationClip: AnimationClip = await this.loadAnimationClipByUuid(assetInfo.uuid);
            if (animationClip) {
                // Thêm clip vào animation.
                this.addClip(animationClip, assetInfo.name);
                this.defaultClip = animationClip;

                // 4. Nếu file .anim vừa được tạo thì reload nhẹ cái Cocos Creator Editor.
                if (isNewAsset) {
                    await Editor.Message.request('scene', 'soft-reload');
                }                
                // log(`[ReferenceAnim] Đã gán thành công clip: ${assetInfo.name}`);
            }

        } catch (error) {
            error("[ReferenceAnim] Lỗi trong quá trình tham chiếu Animation Asset:", error);
        }
    }


    private async playAnimation() {
        if (EDITOR) {
            const currentClip: AnimationClip = this.clips[0];
            const selectedNodeUuid: string = this.node.uuid
            SpinePreviewer.__runningPreviewerUuid = this.uuid;
            await Editor.Message.request('scene', 'record-animation', selectedNodeUuid, true, currentClip.uuid);            
            await Editor.Message.request('scene', 'query-node', selectedNodeUuid);
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



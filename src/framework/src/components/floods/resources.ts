import { TerrainData, WaterData } from './renderer';
import * as THREE from 'three';

interface TerrainApiResponse {
    success: boolean;
    data: {
        terrainMap: string;
        terrainMapSize: [number, number];
        terrainHeightMin: number;
        terrainHeightMax: number;
        lower_left: [number, number];
        lower_right: [number, number];
        upper_right: [number, number];
        upper_left: [number, number];
    };
}

interface WaterApiResponse {
    success: boolean;
    data: {
        durationTime: number;
        waterHuvMaps: string;
        waterHuvMapsSize: [number, number];
        waterHeightMin: number;
        waterHeightMax: number;
        velocityUMin: number;
        velocityUMax: number;
        velocityVMin: number;
        velocityVMax: number;
        lower_left: [number, number];
        lower_right: [number, number];
        upper_right: [number, number];
        upper_left: [number, number];
    };
}

export default class FloodsResources {
    public terrainData: TerrainData | null = null;
    private waterDataSnapshot: WaterData | null = null;
    private tempWaterData: WaterData = {
        durationTime: 0,
        waterHuvMaps: [],
        waterHuvMapsSize: [0, 0] as [number, number],
        waterCorners3857: [
            [0, 0], [0, 0], [0, 0], [0, 0]
        ] as [[number, number], [number, number], [number, number], [number, number]],
        waterHeightMin: [],
        waterHeightMax: [],
        velocityUMin: [],
        velocityUMax: [],
        velocityVMin: [],
        velocityVMax: []
    };
    private currentWaterStep = 1;
    private pollingIntervalId: number | null = null;
    private isPolling = false;
    private isSnapshotReady = false;
    private renderReadyCallback: (() => void) | null = null;
    private textureLoader: THREE.TextureLoader;
    
    // 新增：控制是否使用动态播放模式
    private useDynamicPlayback: boolean = true;
    
    // 新增：记录每一帧的单帧时长（毫秒）
    private frameDuration: number = 5000; // 默认每帧1000ms
    
    constructor() {
        this.textureLoader = new THREE.TextureLoader();
        console.log('FloodsResources initialized');
    }

    // 设置播放模式
    setDynamicPlaybackMode(enabled: boolean, frameDuration?: number): void {
        this.useDynamicPlayback = enabled;
        if (frameDuration !== undefined) {
            this.frameDuration = frameDuration;
        }
        console.log(`Dynamic playback mode: ${enabled ? 'enabled' : 'disabled'}, frame duration: ${this.frameDuration}ms`);
    } 

    // 获取 TerrainData（仅获取一次）
    async fetchTerrainData(): Promise<TerrainData> {
        if (this.terrainData) {
            return this.terrainData;
        }

        try {
            const response = await fetch('http://192.168.31.201:8001/api/solution/get_terrain_data/root.solutions.solution4');
            const result: TerrainApiResponse = await response.json();
            
            if (result.success) {
                // 直接使用后端提供的地形图像路径和角点数据
                // 按照左下、右下、右上、左上的顺序组装角点数组
                const terrainCorners: [[number, number], [number, number], [number, number], [number, number]] = [
                    result.data.lower_left,   // 左下
                    result.data.lower_right,  // 右下
                    result.data.upper_right,  // 右上
                    result.data.upper_left    // 左上
                ];

                this.terrainData = {
                    terrainMap: result.data.terrainMap,
                    terrainMapSize: result.data.terrainMapSize,
                    terrainHeightMin: result.data.terrainHeightMin,
                    terrainHeightMax: result.data.terrainHeightMax,
                    terrainCorners3857: terrainCorners,
                };

                console.log('TerrainData fetched successfully:');
                return this.terrainData;
            } else {
                throw new Error('Failed to fetch terrain data');
            }
        } catch (error) {
            console.error('Error fetching terrain data:', error);
            throw error;
        }
    }

    // 轮询获取 WaterData
    async fetchWaterDataStep(): Promise<boolean> {
        console.log(`fetchWaterDataStep called - current step: ${this.currentWaterStep}`);
        try {
            const url = `http://192.168.31.201:8001/api/simulation/get_water_data/simulation1/${this.currentWaterStep}`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result: WaterApiResponse = await response.json();
            
            if (result.success) {
                // 直接使用后端提供的水体图像路径
                // 累计持续时间
                this.tempWaterData.durationTime += result.data.durationTime;
                
                // 尺寸只存储一次
                if (this.tempWaterData.waterHuvMapsSize[0] === 0) {
                    this.tempWaterData.waterHuvMapsSize = result.data.waterHuvMapsSize;
                }

                // 角点数据只存储一次（假设所有水体数据使用相同的角点）
                if (this.tempWaterData.waterCorners3857[0][0] === 0) {
                    // 按照左下、右下、右上、左上的顺序组装角点数组
                    const waterCorners: [[number, number], [number, number], [number, number], [number, number]] = [
                        result.data.lower_left,   // 左下
                        result.data.lower_right,  // 右下
                        result.data.upper_right,  // 右上
                        result.data.upper_left    // 左上
                    ];
                    this.tempWaterData.waterCorners3857 = waterCorners;
                }

                // 添加到数组
                this.tempWaterData.waterHuvMaps.push(result.data.waterHuvMaps);
                this.tempWaterData.waterHeightMin.push(result.data.waterHeightMin);
                this.tempWaterData.waterHeightMax.push(result.data.waterHeightMax);
                this.tempWaterData.velocityUMin.push(result.data.velocityUMin);
                this.tempWaterData.velocityUMax.push(result.data.velocityUMax);
                this.tempWaterData.velocityVMin.push(result.data.velocityVMin);
                this.tempWaterData.velocityVMax.push(result.data.velocityVMax);

                console.log(`WaterData step ${this.currentWaterStep} fetched successfully. Total maps: ${this.tempWaterData.waterHuvMaps.length}`);

                // 递增步数，准备获取下一步数据
                this.currentWaterStep++;

                // 当获取到第2个 WaterData 时，创建快照，但继续轮询
                if (this.tempWaterData.waterHuvMaps.length === 2 && !this.isSnapshotReady) {
                    console.log('Creating snapshot with 2 water data entries...');
                    await this.createSnapshot();
                    
                    // 如果不使用动态播放模式，停止轮询并触发渲染回调
                    if (!this.useDynamicPlayback) {
                        this.stopPolling();
                        
                        // 触发渲染准备回调
                        if (this.terrainData && this.renderReadyCallback) {
                            console.log('Both terrain data and water snapshot available - triggering render');
                            this.renderReadyCallback();
                            this.renderReadyCallback = null; // 只触发一次
                        }
                        
                        return false; // 停止轮询
                    } else {
                        // 动态播放模式：触发渲染回调但继续轮询
                        if (this.terrainData && this.renderReadyCallback) {
                            console.log('Dynamic mode: data ready, triggering render and continuing polling');
                            this.renderReadyCallback();
                            this.renderReadyCallback = null; // 只触发一次
                        }
                    }
                }

                // 动态播放模式：持续更新动态数据
                if (this.useDynamicPlayback && this.tempWaterData.waterHuvMaps.length > 2) {
                    // 加载新的纹理并添加到动态数组
                    const tex = this.textureLoader.load(result.data.waterHuvMaps);
                    tex.premultiplyAlpha = false;
                    tex.minFilter = THREE.NearestFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false;
                    tex.wrapS = THREE.ClampToEdgeWrapping;
                    tex.wrapT = THREE.ClampToEdgeWrapping;
                    tex.name = result.data.waterHuvMaps;
                    
                    // 如果快照已存在，直接更新其纹理数组
                    if (this.waterDataSnapshot && this.waterDataSnapshot.waterTextures) {
                        this.waterDataSnapshot.waterTextures.push(tex);
                        console.log(`Dynamic mode: added new texture, total count: ${this.waterDataSnapshot.waterTextures.length}`);
                    }
                }

                return true;
            } else {
                console.log(`No more water data available at step ${this.currentWaterStep}`);
                return false;
            }
        } catch (error) {
            console.error(`Error fetching water data step ${this.currentWaterStep}:`, error);
            return false;
        }
    }

    // 创建快照
    async createSnapshot(): Promise<void> {
        if (this.tempWaterData.waterHuvMaps.length < 2) {
            throw new Error('Cannot create snapshot: need at least 2 water data entries');
        }

        console.log('Creating water data snapshot...');
        
        // 加载纹理
        const waterTextures: THREE.Texture[] = [];
        for (const imageUrl of this.tempWaterData.waterHuvMaps) {
            const tex = this.textureLoader.load(imageUrl);
            tex.premultiplyAlpha = false;
            tex.minFilter = THREE.NearestFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.name = imageUrl;
            waterTextures.push(tex);
        }

        // 创建最终快照
        this.waterDataSnapshot = {
            durationTime: this.useDynamicPlayback ? this.frameDuration : this.tempWaterData.durationTime,
            waterHuvMaps: [...this.tempWaterData.waterHuvMaps],
            waterHuvMapsSize: this.tempWaterData.waterHuvMapsSize,
            waterCorners3857: this.tempWaterData.waterCorners3857,
            waterHeightMin: [...this.tempWaterData.waterHeightMin],
            waterHeightMax: [...this.tempWaterData.waterHeightMax],
            velocityUMin: [...this.tempWaterData.velocityUMin],
            velocityUMax: [...this.tempWaterData.velocityUMax],
            velocityVMin: [...this.tempWaterData.velocityVMin],
            velocityVMax: [...this.tempWaterData.velocityVMax],
            waterTextures: waterTextures
        };

        this.isSnapshotReady = true;
        console.log('Water data snapshot created successfully:', {
            totalFrames: this.waterDataSnapshot.waterHuvMaps.length,
            totalDurationTime: this.waterDataSnapshot.durationTime
        });
    }

    // 开始轮询
    async startPolling(onRenderReady?: () => void): Promise<void> {
        if (this.isPolling) {
            return;
        }

        this.renderReadyCallback = onRenderReady || null;
        this.isPolling = true;

        try {
            // 首先获取 TerrainData
            console.log('Starting to fetch terrain data...');
            await this.fetchTerrainData();
            console.log('Terrain data fetched, starting water data polling...');

            // 立即进行第一次水体数据获取
            console.log('Starting first water data fetch...');
            const firstSuccess = await this.fetchWaterDataStep();
            
            // 如果第一次成功且还需要更多数据，开始定时轮询
            if (firstSuccess && this.isPolling) {
                this.pollingIntervalId = window.setInterval(async () => {
                    if (!this.isPolling) {
                        return;
                    }

                    console.log('Polling for next water data step...');
                    const success = await this.fetchWaterDataStep();
                    if (!success) {
                        // 如果获取失败或没有更多数据，可以选择停止轮询
                        // this.stopPolling();
                        console.log('Continuing to poll for more water data...');
                    }
                }, 2000); // 每2秒轮询一次
            }

        } catch (error) {
            console.error('Error starting polling:', error);
            this.stopPolling();
            throw error;
        }
    }

    // 停止轮询
    stopPolling(): void {
        this.isPolling = false;
        if (this.pollingIntervalId) {
            clearInterval(this.pollingIntervalId);
            this.pollingIntervalId = null;
        }
    }

    // 返回快照或动态数据（用于渲染）
    fetchWaterData(): Promise<WaterData> {
        return new Promise<WaterData>((resolve, reject) => {
            if (this.waterDataSnapshot) {
                if (this.useDynamicPlayback) {
                    // 动态播放模式：返回实时的动态数据
                    const dynamicData: WaterData = {
                        durationTime: this.frameDuration,
                        waterHuvMaps: [...this.tempWaterData.waterHuvMaps],
                        waterHuvMapsSize: this.tempWaterData.waterHuvMapsSize,
                        waterCorners3857: this.tempWaterData.waterCorners3857,
                        waterHeightMin: [...this.tempWaterData.waterHeightMin],
                        waterHeightMax: [...this.tempWaterData.waterHeightMax],
                        velocityUMin: [...this.tempWaterData.velocityUMin],
                        velocityUMax: [...this.tempWaterData.velocityUMax],
                        velocityVMin: [...this.tempWaterData.velocityVMin],
                        velocityVMax: [...this.tempWaterData.velocityVMax],
                        waterTextures: this.waterDataSnapshot.waterTextures || []
                    };
                    console.log(`Dynamic mode: returning data with ${dynamicData.waterTextures?.length || 0} textures`);
                    resolve(dynamicData);
                } else {
                    // 快照模式：返回固定的快照数据
                    console.log(`Snapshot mode: returning snapshot with ${this.waterDataSnapshot.waterTextures?.length || 0} textures`);
                    resolve(this.waterDataSnapshot);
                }
            } else {
                reject(new Error('Water data snapshot not ready. Call startPolling() first.'));
            }
        });
    }

    // 检查快照是否准备就绪
    isSnapshotCreated(): boolean {
        return this.isSnapshotReady;
    }

    // 检查是否准备好渲染（TerrainData已获取且快照已创建）
    isReadyForRender(): boolean {
        return this.terrainData !== null && this.isSnapshotReady;
    }

    // 获取当前播放模式
    getDynamicPlaybackMode(): boolean {
        return this.useDynamicPlayback;
    }

    // 获取当前帧时长
    getFrameDuration(): number {
        return this.frameDuration;
    }

    // 获取当前动态数据的帧数
    getCurrentFrameCount(): number {
        return this.tempWaterData.waterHuvMaps.length;
    }
}

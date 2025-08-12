import { TerrainData, WaterData } from './renderer0';

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
    private waterData: WaterData = {
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
    private isDataReady = false;
    private renderReadyCallback: (() => void) | null = null;
    
    // 记录每一帧的单帧时长（毫秒）
    private frameDuration: number = 3000;
    
    constructor() {
        console.log('FloodsResources initialized');
    }

    // 设置帧时长
    setFrameDuration(frameDuration: number): void {
        this.frameDuration = frameDuration;
        console.log(`Frame duration set to: ${this.frameDuration}ms`);
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
                this.waterData.durationTime += result.data.durationTime;
                
                // 尺寸只存储一次
                if (this.waterData.waterHuvMapsSize[0] === 0) {
                    this.waterData.waterHuvMapsSize = result.data.waterHuvMapsSize;
                }

                // 角点数据只存储一次（假设所有水体数据使用相同的角点）
                if (this.waterData.waterCorners3857[0][0] === 0) {
                    // 按照左下、右下、右上、左上的顺序组装角点数组
                    const waterCorners: [[number, number], [number, number], [number, number], [number, number]] = [
                        result.data.lower_left,   // 左下
                        result.data.lower_right,  // 右下
                        result.data.upper_right,  // 右上
                        result.data.upper_left    // 左上
                    ];
                    this.waterData.waterCorners3857 = waterCorners;
                }

                // 添加到数组
                this.waterData.waterHuvMaps.push(result.data.waterHuvMaps);
                this.waterData.waterHeightMin.push(result.data.waterHeightMin);
                this.waterData.waterHeightMax.push(result.data.waterHeightMax);
                this.waterData.velocityUMin.push(result.data.velocityUMin);
                this.waterData.velocityUMax.push(result.data.velocityUMax);
                this.waterData.velocityVMin.push(result.data.velocityVMin);
                this.waterData.velocityVMax.push(result.data.velocityVMax);

                console.log(`WaterData step ${this.currentWaterStep} fetched successfully. Total maps: ${this.waterData.waterHuvMaps.length}`);

                // 递增步数，准备获取下一步数据
                this.currentWaterStep++;

                // 当获取到第一个 WaterData 时，标记数据准备就绪
                if (this.waterData.waterHuvMaps.length === 1 && !this.isDataReady) {
                    this.isDataReady = true;
                    
                    // 触发渲染准备回调
                    if (this.terrainData && this.renderReadyCallback) {
                        console.log('Initial data ready - triggering render');
                        this.renderReadyCallback();
                        this.renderReadyCallback = null; // 只触发一次
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

    // 返回水体数据（用于渲染）
    fetchWaterData(): Promise<WaterData> {
        return new Promise<WaterData>((resolve, reject) => {
            if (this.isDataReady && this.waterData.waterHuvMaps.length > 0) {
                // 设置帧时长
                this.waterData.durationTime = this.frameDuration;
                console.log(`Returning water data with ${this.waterData.waterHuvMaps.length} texture URLs`);
                resolve(this.waterData);
            } else {
                reject(new Error('Water data not ready. Call startPolling() first.'));
            }
        });
    }

    // 检查数据是否准备就绪
    isDataCreated(): boolean {
        return this.isDataReady;
    }

    // 检查是否准备好渲染（TerrainData已获取且水体数据已准备就绪）
    isReadyForRender(): boolean {
        return this.terrainData !== null && this.isDataReady;
    }

    // 获取当前帧时长
    getFrameDuration(): number {
        return this.frameDuration;
    }

    // 获取当前动态数据的帧数
    getCurrentFrameCount(): number {
        return this.waterData.waterHuvMaps.length;
    }
}

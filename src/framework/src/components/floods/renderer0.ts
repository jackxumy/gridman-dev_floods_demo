/* eslint-disable @typescript-eslint/no-this-alias */
import Model from '@/threejs/model/model';
import ThreejsSceneLayer from '@/threejs/threejs-scene';
import { extend } from '@/threejs/utils/Util';
import { SceneUpdateEvent, SceneUpdateEventType } from '@/threejs/object/scene-event';
import { TerrainFragmentShader, TerrainVertexShader } from './shaders/TerrainShader';
import { WaterFragmentShader, WaterVertexShader } from './shaders/WaterShader';

import * as THREE from 'three';
import FloodsResources from './resources0';

export type FloodsConfig = {
    center: [number, number];
    lightColor: string;
    lightDirection: [number, number, number];

    terrainColor: string;
    terrainGeometrySize: [number, number];
    terrainCorners3857: [[number, number], [number, number], [number, number], [number, number]];
    terrainNormalY: number;

    waterGeometrySize: [number, number];
    waterCorners3857: [[number, number], [number, number], [number, number], [number, number]];

    foamMap: string;
    normalMap: string;
    displacementMap: string;
    heightNoiseMap: string;
    heightNoiseNormalMap: string;
    rampMap: string;

    durationTimeScale: number;
    waterNormalY: number;
    normalStrength: number;
    waterAlpha: number;

    minWaterDepth: number;
    maxWaterDepth: number;
    minWaterDepthAlpha: number;
    maxWaterDepthAlpha: number;
    swapTimeMinRange: number;
    swapTimeMaxRange: number;

    waterShallowColor: string;
    waterDeepColor: string;
    waterShallowAlpha: number;
    waterDeepAlpha: number;
    depthDensity: number;
    flowStrength: number;
    gridResolutionA: number;
    wavePeriodA: number;
    flowVelocityStrengthA: number;
    gridResolutionB: number;
    wavePeriodB: number;
    flowVelocityStrengthB: number;
    gridResolutionC: number;
    wavePeriodC: number;
    flowVelocityStrengthC: number;
    gridResolutionD: number;
    wavePeriodD: number;
    flowVelocityStrengthD: number;
    foamMinEdge: number;
    foamMaxEdge: number;
    foamVelocityMaskMinEdge: number;
    foamVelocityMaskMaxEdge: number;
};

const defaultConfig: FloodsConfig = {
    center: [114.028140134, 22.472900679],
    lightColor: '#FFF4D6',
    lightDirection: [50, -30, 0],

    terrainColor: '#FFFFFF',
    terrainGeometrySize: [640, 640],
    terrainCorners3857: [
        [12679881.570319263, 2560830.1529902862],
        [12807218.697355295, 2560830.1529902862],
        [12707218.697355295, 2575950.053680579],
        [12679881.570319263, 2575950.053680579]
    ],
    terrainNormalY: 0.2,

    waterGeometrySize: [640, 640],
    waterCorners3857: [
        [12679908.694269724, 2560846.214908679], 
        [12807202.416285772, 2560846.214908679], 
        [12707202.416285772, 2575922.747069924], 
        [12679908.694269724, 2575922.746308551] 
    ],

    foamMap: './floods/Textures/Foam.png',
    normalMap: './floods/Textures/NormalMap.png',
    displacementMap: './floods/Textures/DisplacementMap.png',
    heightNoiseMap: './floods/Textures/HeightMap.png',
    heightNoiseNormalMap: './floods/Textures/HeightNormalMap.png',
    rampMap: './floods/Textures/RampMap.png',

    durationTimeScale: 1.0,
    waterNormalY: 0.2,
    normalStrength: 10,
    waterAlpha: 0.8,

    minWaterDepth: 0.0,
    maxWaterDepth: 5.0,
    minWaterDepthAlpha: 0.1,
    maxWaterDepthAlpha: 1.0,
    swapTimeMinRange: 0.75,
    swapTimeMaxRange: 1.0,

    waterShallowColor: '#008BA7',
    waterDeepColor: '#2E4A6D',
    waterShallowAlpha: 166.0 / 255.0,
    waterDeepAlpha: 228.0 / 255.0,
    depthDensity: 3.0,
    flowStrength: 1.0,
    gridResolutionA: 52,
    wavePeriodA: 1.578,
    flowVelocityStrengthA: 0.562,
    gridResolutionB: 60,
    wavePeriodB: 1.36,
    flowVelocityStrengthB: 0.512,
    gridResolutionC: 58,
    wavePeriodC: 1.66,
    flowVelocityStrengthC: 0.678,
    gridResolutionD: 54,
    wavePeriodD: 2.54,
    flowVelocityStrengthD: 0.602,
    foamMinEdge: 0.25,
    foamMaxEdge: 0.5,
    foamVelocityMaskMinEdge: 0.05,
    foamVelocityMaskMaxEdge: 0.2,
};

export type TerrainData = {
    terrainMap: string;
    terrainMapSize: [number, number];
    terrainHeightMin: number;
    terrainHeightMax: number;
    terrainCorners3857: [[number, number], [number, number], [number, number], [number, number]];

    terrainTexture?: THREE.Texture;
};

export type WaterData = {
    durationTime: number;
    waterHuvMaps: string[];
    waterHuvMapsSize: [number, number];
    waterCorners3857: [[number, number], [number, number], [number, number], [number, number]];

    waterHeightMin: number[];
    waterHeightMax: number[];
    velocityUMin: number[];
    velocityUMax: number[];
    velocityVMin: number[];
    velocityVMax: number[];
};

export default class FloodsRenderer {
    private _map: mapboxgl.Map;
    private _scene: ThreejsSceneLayer | null;
    private _rootModel: Model | null;
    private _terrainMesh: THREE.Mesh | null;
    private _waterMesh: THREE.Mesh | null;
    private _textureLoader: THREE.TextureLoader;
    private _config: FloodsConfig = defaultConfig;
    private _floodsResources: FloodsResources;
    private _terrainData: TerrainData | null = null;
    private _waterData: WaterData | null = null;
    private _waterTextures: THREE.Texture[] = []; // 当前渲染使用的纹理组（最多4个）
    private _nextWaterTextures: THREE.Texture[] = []; // 下一组预加载的纹理（最多4个）
    private _currentTextureGroup: number = 0; // 当前渲染的纹理组索引
    private _isLoadingNextGroup: boolean = false; // 是否正在加载下一组纹理
    private _batchSize: number = 4; // 每批纹理数量
    private _simulationTime: number = 0.0;
    private _useConfigFile: boolean = false; // 新增变量，控制是否使用配置文件

    constructor(map: mapboxgl.Map) {
        this._map = map;
        this._scene = null;
        this._rootModel = null;
        this._terrainMesh = null;
        this._waterMesh = null;

        this._floodsResources = new FloodsResources();
        this._textureLoader = new THREE.TextureLoader();

        this._map.transform._allowWorldUnderZoom = true;
        this._map.on('load', async () => {
            if (this._useConfigFile) {
                await fetch('./floods/config.json')
                    .then((response) => response.json())
                    .then((config) => {
                        this._config = extend({}, defaultConfig, config);
                    });
            } else {
                this._config = defaultConfig; // 使用默认配置
            }

            await this.initScene();
        });
    }

    clean() {
        if (this._scene) this._map.removeLayer(this._scene.id);
        
        // 清理动态更新定时器
        if ((this as any)._dynamicUpdateInterval) {
            clearInterval((this as any)._dynamicUpdateInterval);
            (this as any)._dynamicUpdateInterval = null;
        }
        
        // 清理持续轮询定时器
        if ((this as any)._continuousPollingInterval) {
            clearInterval((this as any)._continuousPollingInterval);
            (this as any)._continuousPollingInterval = null;
        }
        
        // 清理纹理缓存
        this._waterTextures.forEach(texture => {
            texture.dispose();
        });
        this._waterTextures = [];
        
        this._nextWaterTextures.forEach(texture => {
            texture.dispose();
        });
        this._nextWaterTextures = [];
        
        this._currentTextureGroup = 0;
        this._isLoadingNextGroup = false;
        
        // 停止资源轮询
        if (this._floodsResources) {
            this._floodsResources.stopPolling();
        }
    }

    async initScene() {
        console.log('Starting scene initialization...');
        
        // 第一步：获取初始数据并更新配置
        await this.loadInitialDataAndUpdateConfig();
        
        // 第二步：计算统一的中心点（使用更新后的配置）
        const center = this.calculateUnifiedNormalizationAndCenter();
        const { center4326: sceneCenter } = center;

        console.log('Scene Center:', sceneCenter);
        this._scene = new ThreejsSceneLayer({
            id: 'floods-scene',
            refCenter: sceneCenter,
        });

        this._map.addLayer(this._scene);

        const scope = this;
        // 使用计算得到的中心点
        const { center4326: modelCenter } = center;
        this._rootModel = this._scene.addModel({
            id: 'root-model',
            position: modelCenter,
            rotation: [0, 0, 0],
            scale: 1,
            offset: [0, 0, 0],
            callback: function (model) {
                if (model.children.length > 0) {
                    const group = model.children[0];
                    
                    // 第三步：使用更新的配置创建mesh
                    scope._terrainMesh = scope.createTerrainMesh();
                    group.add(scope._terrainMesh);
                    scope._waterMesh = scope.createWaterMesh();
                    group.add(scope._waterMesh);

                    // 第四步：更新资源（纹理等）
                    scope.updateTerrainResources();
                    scope.updateWaterResources();

                    // 第五步：开始持续的水体数据轮询
                    scope.startContinuousWaterPolling();

                    const onSceneUpdate = function onSceneUpdate(event: SceneUpdateEvent) {
                        scope.updateSceneTime(event.time, event.delta);
                    };
                    scope._scene?.addEventListener(SceneUpdateEventType, onSceneUpdate);
                }
            },
        });
    }

    loadTexture(image: string) {
        const textureLoader = this._textureLoader;
        const texture = textureLoader.load(image);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    // 将3857坐标转换为4326坐标系
    convert3857To4326(x: number, y: number): [number, number] {
        const lon = (x / 20037508.34) * 180;
        let lat = (y / 20037508.34) * 180;
        lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
        return [lon, lat];
    }

    // 计算八个角点的统一归一化和中心点
    calculateUnifiedNormalizationAndCenter(): {
        terrainNormalizedCorners: [[number, number], [number, number], [number, number], [number, number]],
        waterNormalizedCorners: [[number, number], [number, number], [number, number], [number, number]],
        center4326: [number, number]
    } {
        // 收集所有八个角点
        const allCorners3857: [number, number][] = [
            ...this._config.terrainCorners3857,
            ...this._config.waterCorners3857
        ];

        // 找到所有点的边界
        const minX = Math.min(...allCorners3857.map(p => p[0]));
        const maxX = Math.max(...allCorners3857.map(p => p[0]));
        const minY = Math.min(...allCorners3857.map(p => p[1]));
        const maxY = Math.max(...allCorners3857.map(p => p[1]));

        // 计算八个点的中心点（3857坐标系）
        const centerX3857 = (minX + maxX) / 2;
        const centerY3857 = (minY + maxY) / 2;

        // 转换中心点到4326坐标系
        const center4326 = this.convert3857To4326(centerX3857, centerY3857);

        // 计算归一化坐标（相对于中心点）
        const terrainNormalizedCorners: [[number, number], [number, number], [number, number], [number, number]] = 
            this._config.terrainCorners3857.map(([x, y]) => [x - centerX3857, y - centerY3857]) as [[number, number], [number, number], [number, number], [number, number]];

        const waterNormalizedCorners: [[number, number], [number, number], [number, number], [number, number]] = 
            this._config.waterCorners3857.map(([x, y]) => [x - centerX3857, y - centerY3857]) as [[number, number], [number, number], [number, number], [number, number]];

        return {
            terrainNormalizedCorners,
            waterNormalizedCorners,
            center4326
        };
    }

    // 从四个角点的归一化坐标创建BufferGeometry，功能等同于PlaneGeometry
    createGeometryFromCorners(
        corner: [[number, number], [number, number], [number, number], [number, number]],
        size: [number, number]
    ): THREE.BufferGeometry {
        const [widthSegments, heightSegments] = size;
        const [p00, p10, p11, p01] = corner.map(([x, y]) => new THREE.Vector3(x, y, 0));

        const vertices: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];

        // 生成顶点和 UV
        for (let iy = 0; iy <= heightSegments; iy++) {
            const v = iy / heightSegments;
            for (let ix = 0; ix <= widthSegments; ix++) {
                const u = ix / widthSegments;

                // 双线性插值计算（使用归一化坐标）
                const scale = 0.93; // 缩放因子
                const px = (1 - u) * (1 - v) * p00.x +
                        u * (1 - v) * p10.x +
                        u * v * p11.x +
                        (1 - u) * v * p01.x;
                const py = (1 - u) * (1 - v) * p00.y +
                        u * (1 - v) * p10.y +
                        u * v * p11.y +
                        (1 - u) * v * p01.y;

                vertices.push(px * scale, py * scale, 0);
                uvs.push(u, v);
            }
        }

    // 生成索引（两个三角形构成一个方格）
    for (let iy = 0; iy < heightSegments; iy++) {
        for (let ix = 0; ix < widthSegments; ix++) {
            const a = iy * (widthSegments + 1) + ix;
            const b = a + 1;
            const c = a + (widthSegments + 1);
            const d = c + 1;

            indices.push(a, b, d);
            indices.push(a, d, c);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
    }

    createTerrainMesh(): THREE.Mesh {
        const lightColor = new THREE.Color(this._config.lightColor).convertLinearToSRGB();
        const lightEuler = new THREE.Euler((this._config.lightDirection[0] * Math.PI) / 180, (this._config.lightDirection[1] * Math.PI) / 180, (this._config.lightDirection[2] * Math.PI) / 180);
        const lightDirection = new THREE.Vector3(0, 0, -1).applyEuler(lightEuler);

        const terrainColor = new THREE.Color(this._config.terrainColor); //.convertLinearToSRGB();

        // 获取统一归一化的坐标
        const { terrainNormalizedCorners } = this.calculateUnifiedNormalizationAndCenter();
        const geometry = this.createGeometryFromCorners(terrainNormalizedCorners, this._config.terrainGeometrySize);
        console.log(geometry);
        const terrainNormalY = this._config.terrainNormalY;

        const terrainUniforms = {
            lightColor: { value: lightColor },
            lightDirection: { value: lightDirection },
            terrainMap: { value: null },
            terrainMapSize: { value: new THREE.Vector2(0, 0) },
            terrainColor: { value: terrainColor },
            terrainNormalY: { value: terrainNormalY },
            minTerrainHeight: { value: 0.0 },
            maxTerrainHeight: { value: 0.0 },
        };

        const material = new THREE.ShaderMaterial({
            uniforms: terrainUniforms,
            vertexShader: TerrainVertexShader,
            fragmentShader: TerrainFragmentShader,
            side: THREE.DoubleSide,
        });

        // 创建地形网格
        const terrain = new THREE.Mesh(geometry, material);
        console.log(terrain);
        return terrain;
    }

    createWaterMesh(): THREE.Mesh {
        const lightColor = new THREE.Color(this._config.lightColor).convertLinearToSRGB();
        const lightEuler = new THREE.Euler((this._config.lightDirection[0] * Math.PI) / 180, (this._config.lightDirection[1] * Math.PI) / 180, (this._config.lightDirection[2] * Math.PI) / 180);
        const lightDirection = new THREE.Vector3(0, 0, -1).applyEuler(lightEuler);

        const foamMap = this.loadTexture(this._config.foamMap);
        const normalMap = this.loadTexture(this._config.normalMap);
        const displacementMap = this.loadTexture(this._config.displacementMap);
        const heightNoiseMap = this.loadTexture(this._config.heightNoiseMap);
        const heightNoiseNormalMap = this.loadTexture(this._config.heightNoiseNormalMap);
        const rampMap = this.loadTexture(this._config.rampMap);

        foamMap.repeat = new THREE.Vector2(500, 500);

        // 获取统一归一化的坐标
        const { waterNormalizedCorners } = this.calculateUnifiedNormalizationAndCenter();
        const geometry = this.createGeometryFromCorners(waterNormalizedCorners, this._config.waterGeometrySize);

        const uniforms = {
            // 纹理
            displacementMap: { value: displacementMap },
            normalMap: { value: normalMap },
            terrainMap: { value: null },
            foamMap: { value: foamMap },
            heightNoiseMap: { value: heightNoiseMap },
            heightNoiseNormalMap: { value: heightNoiseNormalMap },
            rampMap: { value: rampMap },

            // 参数
            time: { value: 0.0 },
            timeStep: { value: 0.0 },

            lightColor: { value: lightColor },
            lightDirection: { value: lightDirection },
            huvMapSize: { value: new THREE.Vector2(0, 0) },
            terrainMapSize: { value: new THREE.Vector2(0, 0) },
            minTerrainHeight: { value: 0.0 },
            maxTerrainHeight: { value: 0.0 },

            huvMapBefore: { value: null },
            huvMapAfter: { value: null },
            minWaterHeightBefore: { value: 0.001 },
            maxWaterHeightBefore: { value: 0.01 },
            minWaterHeightAfter: { value: 0.001 },
            maxWaterHeightAfter: { value: 0.01 },
            minVelocityUBefore: { value: 0.0 },
            maxVelocityUBefore: { value: 0.0 },
            minVelocityUAfter: { value: 0.0 },
            maxVelocityUAfter: { value: 0.0 },
            minVelocityVBefore: { value: 0.0 },
            maxVelocityVBefore: { value: 0.0 },
            minVelocityVAfter: { value: 0.0 },
            maxVelocityVAfter: { value: 0.0 },

            normalStrength: { value: this._config.normalStrength },
            waterNormalY: { value: this._config.waterNormalY },
            waterAlpha: { value: this._config.waterAlpha },

            minWaterDepth: { value: this._config.minWaterDepth },
            maxWaterDepth: { value: this._config.maxWaterDepth },
            minWaterDepthAlpha: { value: this._config.minWaterDepthAlpha },
            maxWaterDepthAlpha: { value: this._config.maxWaterDepthAlpha },
            swapTimeMinRange: { value: this._config.swapTimeMinRange },
            swapTimeMaxRange: { value: this._config.swapTimeMaxRange },

            waterShallowColor: { value: new THREE.Color(this._config.waterShallowColor) },
            waterDeepColor: { value: new THREE.Color(this._config.waterDeepColor) },
            waterShallowAlpha: { value: this._config.waterShallowAlpha },
            waterDeepAlpha: { value: this._config.waterDeepAlpha },
            depthDensity: { value: this._config.depthDensity },
            flowStrength: { value: this._config.flowStrength },
            gridResolutionA: { value: this._config.gridResolutionA },
            wavePeriodA: { value: this._config.wavePeriodA },
            flowVelocityStrengthA: { value: this._config.flowVelocityStrengthA },
            gridResolutionB: { value: this._config.gridResolutionB },
            wavePeriodB: { value: this._config.wavePeriodB },
            flowVelocityStrengthB: { value: this._config.flowVelocityStrengthB },
            gridResolutionC: { value: this._config.gridResolutionC },
            wavePeriodC: { value: this._config.wavePeriodC },
            flowVelocityStrengthC: { value: this._config.flowVelocityStrengthC },
            gridResolutionD: { value: this._config.gridResolutionD },
            wavePeriodD: { value: this._config.wavePeriodD },
            flowVelocityStrengthD: { value: this._config.flowVelocityStrengthD },
            foamMinEdge: { value: this._config.foamMinEdge },
            foamMaxEdge: { value: this._config.foamMaxEdge },
            foamVelocityMaskMinEdge: { value: this._config.foamVelocityMaskMinEdge },
            foamVelocityMaskMaxEdge: { value: this._config.foamVelocityMaskMaxEdge },
        };

        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: WaterVertexShader,
            fragmentShader: WaterFragmentShader,
            transparent: true,
            depthWrite: true,
            blending: THREE.CustomBlending,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendEquation: THREE.AddEquation,
        });

        // 创建水面网格
        const water = new THREE.Mesh(geometry, material);

        return water;
    }

    // 新增方法：加载初始数据并更新配置
    async loadInitialDataAndUpdateConfig() {
        console.log('Loading initial terrain and water data...');
        
        try {
            // 获取地形数据
            const terrainData = await this._floodsResources.fetchTerrainData();
            console.log('Initial terrain data loaded:', terrainData);
            
            // 更新配置中的地形相关数据
            this._config.terrainCorners3857 = terrainData.terrainCorners3857;
            console.log('Updated terrain corners in config:', this._config.terrainCorners3857);
            
            // 手动获取第一批水体数据
            console.log('Fetching initial water data...');
            const success = await (this._floodsResources as any).fetchWaterDataStep();
            if (success) {
                // 获取初始水体数据
                const initialWaterData = await this._floodsResources.fetchWaterData();
                console.log('Initial water data loaded:', {
                    frameCount: initialWaterData.waterHuvMaps.length,
                    corners: initialWaterData.waterCorners3857
                });
                
                // 更新配置中的水体相关数据
                this._config.waterCorners3857 = initialWaterData.waterCorners3857;
                console.log('Updated water corners in config:', this._config.waterCorners3857);
            }
            
            console.log('Initial data loading and config update completed');
        } catch (error) {
            console.error('Error loading initial data:', error);
            throw error;
        }
    }

        // 新增方法：开始持续的水体数据轮询
    startContinuousWaterPolling() {
        console.log('Starting continuous water data polling...');
        
        // 设置较长的帧时长以减少闪烁
        this._floodsResources.setFrameDuration(3000); // 每帧3秒
        
        // 开始轮询更多水体数据，但不立即更新显示
        const pollingInterval = setInterval(async () => {
            try {
                const success = await (this._floodsResources as any).fetchWaterDataStep();
                if (success) {
                    console.log(`Current frame count: ${this._floodsResources.getCurrentFrameCount()}`);
                } else {
                    console.log('No more water data available, continuing to poll...');
                }
            } catch (error) {
                console.error('Error in continuous water polling:', error);
            }
        }, 5000); // 减少轮询频率，每5秒轮询一次
        
        // 存储 interval ID 以便后续清理
        (this as any)._continuousPollingInterval = pollingInterval;
        
        // 定期更新水体资源显示，使用较长的间隔
        const displayUpdateInterval = setInterval(async () => {
            try {
                await this.updateWaterResources();
                
                // 打印纹理组状态
                const status = this.getTextureGroupStatus();
                console.log(`Texture status - Group: ${status.currentGroup}/${status.totalGroups}, ` +
                          `Current batch: ${status.currentBatchSize}, Next ready: ${status.nextBatchReady}, ` +
                          `Loading: ${status.isLoading}`);
            } catch (error) {
                console.error('Error during dynamic water resource update:', error);
            }
        }, this._floodsResources.getFrameDuration()); // 使用帧时长作为更新间隔
        
        // 存储 interval ID 以便后续清理
        (this as any)._dynamicUpdateInterval = displayUpdateInterval;
    }

    async updateTerrainResources() {
        // 使用轮询机制获取的地形数据
        if (this._floodsResources.terrainData) {
            this._terrainData = this._floodsResources.terrainData;

            const textureLoader = this._textureLoader;
            const terrainTexture = textureLoader.load(this._terrainData.terrainMap);
            terrainTexture.minFilter = THREE.NearestFilter; // 或 THREE.LinearFilter
            terrainTexture.magFilter = THREE.NearestFilter; // 或 THREE.LinearFilter
            terrainTexture.generateMipmaps = false; // 禁用 Mipmap

            this._terrainData.terrainTexture = terrainTexture;
            
            // 更新配置中的角点信息
            this._config.terrainCorners3857 = this._terrainData.terrainCorners3857;
            
            console.log('Terrain resources updated with new data');
        } else {
            console.error('No terrain data available from resources');
        }
    }

    async updateWaterResources() {
        // 使用轮询机制获取的水体数据
        try {
            const data = await this._floodsResources.fetchWaterData();
            
            // 直接替换数据
            this._waterData = data;

            // 初次加载：当前纹理数量小于批量大小且有足够的URL时
            if (this._waterTextures.length < this._batchSize && this._waterData.waterHuvMaps.length >= this._batchSize) {
                await this.loadInitialTextureBatch();
            }

            // 更新配置中的角点信息
            this._config.waterCorners3857 = this._waterData.waterCorners3857;
            
            console.log(`Water resources updated. Current texture group: ${this._currentTextureGroup}, textures loaded: ${this._waterTextures.length}`);
        } catch (error) {
            console.error('Error updating water resources:', error);
        }
    }

    // 加载初始纹理批次（前4个）
    private async loadInitialTextureBatch(): Promise<void> {
        if (!this._waterData) return;

        console.log('Loading initial texture batch...');
        const startIndex = 0;
        const endIndex = Math.min(this._batchSize, this._waterData.waterHuvMaps.length);
        
        for (let i = startIndex; i < endIndex; i++) {
            const textureUrl = this._waterData.waterHuvMaps[i];
            const texture = await this.loadTextureAsync(textureUrl);
            this._waterTextures.push(texture);
        }
        
        this._currentTextureGroup = 0;
        console.log(`Initial texture batch loaded: ${this._waterTextures.length} textures`);
    }

    // 加载下一组纹理批次
    private async loadNextTextureBatch(): Promise<void> {
        if (!this._waterData || this._isLoadingNextGroup) return;

        this._isLoadingNextGroup = true;
        console.log('Loading next texture batch...');

        const nextGroupIndex = this._currentTextureGroup + 1;
        const startIndex = nextGroupIndex * this._batchSize;
        const endIndex = Math.min(startIndex + this._batchSize, this._waterData.waterHuvMaps.length);
        
        // 如果没有更多纹理，循环回到开始
        const actualStartIndex = startIndex >= this._waterData.waterHuvMaps.length ? 0 : startIndex;
        const actualEndIndex = startIndex >= this._waterData.waterHuvMaps.length ? 
            Math.min(this._batchSize, this._waterData.waterHuvMaps.length) : endIndex;
        
        // 清理上一组预加载的纹理
        this._nextWaterTextures.forEach(texture => texture.dispose());
        this._nextWaterTextures = [];
        
        // 加载新的纹理批次
        for (let i = actualStartIndex; i < actualEndIndex; i++) {
            const textureUrl = this._waterData.waterHuvMaps[i];
            try {
                const texture = await this.loadTextureAsync(textureUrl);
                this._nextWaterTextures.push(texture);
            } catch (error) {
                console.error(`Failed to load texture ${textureUrl}:`, error);
            }
        }
        
        this._isLoadingNextGroup = false;
        console.log(`Next texture batch loaded: ${this._nextWaterTextures.length} textures`);
    }

    // 切换到下一组纹理
    private switchToNextTextureBatch(): void {
        if (this._nextWaterTextures.length === 0) return;

        console.log('Switching to next texture batch...');
        
        // 清理当前纹理
        this._waterTextures.forEach(texture => texture.dispose());
        
        // 切换到下一组
        this._waterTextures = this._nextWaterTextures;
        this._nextWaterTextures = [];
        
        // 更新当前组索引
        this._currentTextureGroup = (this._currentTextureGroup + 1) % Math.ceil(this._waterData!.waterHuvMaps.length / this._batchSize);
        
        console.log(`Switched to texture group ${this._currentTextureGroup}`);
        
        // 立即开始加载下一组
        this.loadNextTextureBatch();
    }

    // 异步加载单个纹理
    private loadTextureAsync(url: string): Promise<THREE.Texture> {
        return new Promise((resolve, reject) => {
            const texture = this._textureLoader.load(
                url,
                // 加载成功回调
                () => {
                    console.log(`Texture loaded successfully: ${url}`);
                    resolve(texture);
                },
                // 加载进度回调
                undefined,
                // 加载失败回调
                (error) => {
                    console.error(`Failed to load texture: ${url}`, error);
                    reject(error);
                }
            );
            
            // 设置纹理参数
            texture.premultiplyAlpha = false;
            texture.minFilter = THREE.NearestFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.name = url;
        });
    }

    // 获取纹理组状态信息
    getTextureGroupStatus(): {
        currentGroup: number;
        totalGroups: number;
        currentBatchSize: number;
        nextBatchReady: boolean;
        isLoading: boolean;
    } {
        const totalGroups = this._waterData ? Math.ceil(this._waterData.waterHuvMaps.length / this._batchSize) : 0;
        return {
            currentGroup: this._currentTextureGroup,
            totalGroups,
            currentBatchSize: this._waterTextures.length,
            nextBatchReady: this._nextWaterTextures.length > 0,
            isLoading: this._isLoadingNextGroup
        };
    }

    updateTerrainUniforms(time: number) {
        const material = this._terrainMesh?.material as THREE.ShaderMaterial;
        if (!material || !this._terrainData || !this._terrainData.terrainTexture) {
            return;
        }
        const uniforms = material.uniforms;
        uniforms.terrainMap.value = this._terrainData.terrainTexture;
        uniforms.minTerrainHeight.value = this._terrainData.terrainHeightMin;
        uniforms.maxTerrainHeight.value = this._terrainData.terrainHeightMax;
        uniforms.terrainMapSize.value = new THREE.Vector2(...this._terrainData.terrainMapSize);
    }

    updateWaterUniforms(time: number) {
        const material = this._waterMesh?.material as THREE.ShaderMaterial;
        if (!material || !this._waterData || this._waterTextures.length === 0 || !this._terrainData || !this._terrainData.terrainTexture) {
            return;
        }

        const numRasters = this._waterTextures.length;
        if (numRasters < 1) {
            return;
        }

        // 使用固定的帧时长进行连续播放
        const frameDuration = this._floodsResources.getFrameDuration(); 
        
        let currIndex = Math.floor(time / frameDuration) % numRasters;
        let nextIndex = (currIndex + 1) % numRasters;
        const timeStep = (time % frameDuration) / frameDuration;
        
        // 确保索引在有效范围内
        currIndex = Math.max(0, Math.min(currIndex, numRasters - 1));
        nextIndex = Math.max(0, Math.min(nextIndex, numRasters - 1));

        // 检查是否需要切换到下一批纹理
        // 当当前批次的最后一个纹理渲染完成时，切换到下一批
        if (currIndex === numRasters - 1 && timeStep > 0.9 && this._nextWaterTextures.length > 0) {
            this.switchToNextTextureBatch();
            return; // 本帧跳过渲染，等待下一帧使用新纹理
        }
        
        // 如果当前批次即将结束但下一批还未准备好，开始加载下一批
        if (currIndex === numRasters - 2 && !this._isLoadingNextGroup && this._nextWaterTextures.length === 0) {
            this.loadNextTextureBatch();
        }

        // 确保纹理加载完成
        if (!this._waterTextures[currIndex] || !this._waterTextures[nextIndex]) {
            console.warn('Skipping frame update: textures not fully loaded');
            return;
        }

        // 更新uniforms
        const uniforms = material.uniforms;

        uniforms.time.value = time;
        uniforms.timeStep.value = timeStep;

        uniforms.terrainMap.value = this._terrainData.terrainTexture;
        uniforms.minTerrainHeight.value = this._terrainData.terrainHeightMin;
        uniforms.maxTerrainHeight.value = this._terrainData.terrainHeightMax;
        uniforms.terrainMapSize.value = new THREE.Vector2(...this._terrainData.terrainMapSize);
        uniforms.huvMapSize.value = new THREE.Vector2(...this._waterData.waterHuvMapsSize);

        uniforms.huvMapBefore.value = this._waterTextures[currIndex];
        uniforms.huvMapAfter.value = this._waterTextures[nextIndex];

        // 计算在整个数据集中的实际索引
        const globalCurrIndex = this._currentTextureGroup * this._batchSize + currIndex;
        const globalNextIndex = this._currentTextureGroup * this._batchSize + nextIndex;
        
        // 确保数据数组索引有效
        if (globalCurrIndex < this._waterData.waterHeightMin.length) {
            uniforms.minWaterHeightBefore.value = this._waterData.waterHeightMin[globalCurrIndex];
            uniforms.maxWaterHeightBefore.value = this._waterData.waterHeightMax[globalCurrIndex];
            uniforms.minVelocityUBefore.value = this._waterData.velocityUMin[globalCurrIndex];
            uniforms.maxVelocityUBefore.value = this._waterData.velocityUMax[globalCurrIndex];
            uniforms.minVelocityVBefore.value = this._waterData.velocityVMin[globalCurrIndex];
            uniforms.maxVelocityVBefore.value = this._waterData.velocityVMax[globalCurrIndex];
        }

        if (globalNextIndex < this._waterData.waterHeightMin.length) {
            uniforms.minWaterHeightAfter.value = this._waterData.waterHeightMin[globalNextIndex];
            uniforms.maxWaterHeightAfter.value = this._waterData.waterHeightMax[globalNextIndex];
            uniforms.minVelocityUAfter.value = this._waterData.velocityUMin[globalNextIndex];
            uniforms.maxVelocityUAfter.value = this._waterData.velocityUMax[globalNextIndex];
            uniforms.minVelocityVAfter.value = this._waterData.velocityVMin[globalNextIndex];
            uniforms.maxVelocityVAfter.value = this._waterData.velocityVMax[globalNextIndex];
        }
    }

    updateSceneTime(time: number, delta: number) {
        this._simulationTime += delta;
        this.updateTerrainUniforms(this._simulationTime);
        this.updateWaterUniforms(this._simulationTime);
    }
}

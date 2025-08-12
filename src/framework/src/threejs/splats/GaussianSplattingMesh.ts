import {
    BufferGeometry,
    Camera,
    ColorRepresentation,
    Group,
    Material,
    Mesh,
    Scene,
    Vector2,
    Vector3,
    Vector4,
    Quaternion,
    Matrix4,
    WebGLRenderer,
    DataTexture,
    PixelFormat,
    UnsignedIntType,
    FloatType,
    UnsignedByteType,
    HalfFloatType,
    DataUtils,
    RGBAFormat,
    RGBAIntegerFormat,
    RGIntegerFormat,
    ClampToEdgeWrapping,
    Box3,
    InstancedBufferGeometry,
    BufferAttribute,
    UVMapping,
    LinearFilter,
    NearestFilter,
    RGFormat,
    Sphere,
    InterleavedBufferAttribute,
} from 'three';
import { GaussianSplattingGeometry } from './GaussianSplattingGeometry';
import { GaussianSplattingMaterial } from './GaussianSplattingMaterial';
import { Coroutine, createYieldingScheduler, runCoroutineAsync, runCoroutineSync } from '../utils/coroutine';
import { GaussianSplattingSorter } from './GaussianSplattingSorter';

/* eslint-disable @typescript-eslint/naming-convention */
/** Alias type for value that can be null */
export type Nullable<T> = T | null;

interface DelayedTextureUpdate {
    covA: Uint16Array;
    covB: Uint16Array;
    colors: Uint8Array;
    centers: Float32Array;
    sh?: Uint8Array[];
}

function ToHalfFloat(val) {
    return DataUtils.toHalfFloat(val);
}

/**
 * Class used to render a gaussian splatting mesh
 */
export class GaussianSplattingMesh extends Mesh {
    private _vertexCount = 0;
    private _worker: Nullable<GaussianSplattingSorter> = null;
    private _frameIdLastUpdate = -1;
    private _frameIdThisUpdate = 0;
    private _cameraMatrix: Matrix4 = null;
    private _modelViewMatrix: Matrix4 = null;
    private _canPostToWorker = false;
    private _readyToDisplay = false;
    private _covariancesATexture: Nullable<DataTexture> = null;
    private _covariancesBTexture: Nullable<DataTexture> = null;
    private _centersTexture: Nullable<DataTexture> = null;
    private _colorsTexture: Nullable<DataTexture> = null;
    private _splatPositions: Nullable<Float32Array> = null;
    private _splatPositions2: Nullable<Float32Array> = null;
    private _splatIndex: Nullable<Float32Array> = null;
    private _splatIndex2: Nullable<Uint32Array> = null;
    private _shTextures: Nullable<DataTexture[]> = null;
    private _splatsData: Nullable<ArrayBuffer> = null;
    private _sh: Nullable<Uint8Array[]> = null;
    private readonly _keepInRam: boolean = false;

    private _oldDirection = new Vector3();
    private _useRGBACovariants = false;

    private _tmpCovariances = [0, 0, 0, 0, 0, 0];
    private _sortIsDirty = false;

    private static _RowOutputLength = 3 * 4 + 3 * 4 + 4 + 4; // Vector3 position, Vector3 scale, 1 u8 quaternion, 1 color with alpha
    private static _SH_C0 = 0.28209479177387814;
    // batch size between 2 yield calls. This value is a tradeoff between updates overhead and framerate hiccups
    // This step is faster the PLY conversion. So batch size can be bigger
    private static _SplatBatchSize = 327680;
    // batch size between 2 yield calls during the PLY to splat conversion.
    private static _PlyConversionBatchSize = 32768;
    private _shDegree = 0;

    boundingBox: Box3;
    boundingSphere: Sphere;

    /**
     * SH degree. 0 = no sh (default). 1 = 3 parameters. 2 = 8 parameters. 3 = 15 parameters.
     */
    public get shDegree() {
        return this._shDegree;
    }

    /**
     * returns the splats data array buffer that contains in order : postions (3 floats), size (3 floats), color (4 bytes), orientation quaternion (4 bytes)
     */
    public get splatsData() {
        return this._splatsData;
    }

    /**
     * Gets the covariancesA texture
     */
    public get covariancesATexture() {
        return this._covariancesATexture;
    }

    /**
     * Gets the covariancesB texture
     */
    public get covariancesBTexture() {
        return this._covariancesBTexture;
    }

    /**
     * Gets the centers texture
     */
    public get centersTexture() {
        return this._centersTexture;
    }

    /**
     * Gets the colors texture
     */
    public get colorsTexture() {
        return this._colorsTexture;
    }

    /**
     * Gets the SH textures
     */
    public get shTextures() {
        return this._shTextures;
    }

    /**
     * Creates a new gaussian splatting mesh
     * @param name defines the name of the mesh
     * @param url defines the url to load from (optional)
     * @param scene defines the hosting scene (optional)
     * @param keepInRam keep datas in ram for editing purpose
     */
    constructor() {
        super();

        this.geometry = GaussianSplattingGeometry.build();
        this.material = GaussianSplattingMaterial.build();

        this.setEnabled(false);
        this._useRGBACovariants = true;
    }

    readonly isGaussianSplattingMesh: true = true;
    /**
     * @override
     * @defaultValue `Mesh`
     */
    override readonly type: string | 'GaussianSplattingMesh';

    setEnabled(enabled: boolean): void {
        this.visible = enabled;
    }

    /** @internal */
    public _postToWorker(forced = false): Promise<void> | undefined {
        const frameId = this._frameIdThisUpdate;
        if ((forced || frameId !== this._frameIdLastUpdate) && this._worker && this._cameraMatrix && this._canPostToWorker) {
            const cameraMatrix = this._cameraMatrix;
            this._modelViewMatrix = new Matrix4().multiplyMatrices(cameraMatrix, this.matrixWorld);

            let TmpMatrix0 = cameraMatrix.clone().invert();
            let TmpMatrix1 = new Matrix4().multiplyMatrices(TmpMatrix0, this.matrixWorld);

            const newDirection = new Vector3(0, 0, 1).transformDirection(TmpMatrix1);
            const dot = newDirection.dot(this._oldDirection);

            if (forced || Math.abs(dot - 1) >= 0.01) {
                this._oldDirection.copy(newDirection);
                this._frameIdLastUpdate = frameId;
                this._canPostToWorker = false;
                return this._worker.sortDataAsync(this._modelViewMatrix.elements);
            }
        }
    }

    override onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material, group: Group): void {
        this._frameIdThisUpdate = renderer.info.render.frame;
        this.sortDataAsync(camera);

        GaussianSplattingMaterial.updateUniforms(renderer, camera, this);
        super.onBeforeRender(renderer, scene, camera, geometry, material, group);
    }

    /**
     * Loads a .splat Gaussian Splatting array buffer asynchronously
     * @param data arraybuffer containing splat file
     * @returns a promise that resolves when the operation is complete
     */

    public loadDataAsync(data: ArrayBuffer): Promise<void> {
        return this.updateDataAsync(data);
    }

    /**
     * Releases resources associated with this mesh.
     * @param doNotRecurse Set to true to not recurse into each children (recurse into each children by default)
     */
    public dispose(): void {
        this._covariancesATexture?.dispose();
        this._covariancesBTexture?.dispose();
        this._centersTexture?.dispose();
        this._colorsTexture?.dispose();
        if (this._shTextures) {
            this._shTextures.forEach((shTexture) => {
                shTexture.dispose();
            });
        }

        this._covariancesATexture = null;
        this._covariancesBTexture = null;
        this._centersTexture = null;
        this._colorsTexture = null;
        this._shTextures = null;

        this._worker?.terminate();
        this._worker = null;

        // super.dispose();
    }

    private _copyTextures(source: GaussianSplattingMesh): void {
        this._covariancesATexture = source.covariancesATexture?.clone()!;
        this._covariancesBTexture = source.covariancesBTexture?.clone()!;
        this._centersTexture = source.centersTexture?.clone()!;
        this._colorsTexture = source.colorsTexture?.clone()!;
        if (source._shTextures) {
            this._shTextures = [];
            this._shTextures.forEach((shTexture) => {
                this._shTextures?.push(shTexture.clone()!);
            });
        }
    }

    /**
     * Returns a new Mesh object generated from the current mesh properties.
     * @param name is a string, the name given to the new mesh
     * @returns a new Gaussian Splatting Mesh
     */
    //@ts-ignore
    public override clone(recursive?: boolean): GaussianSplattingMesh {
        const newGS = new GaussianSplattingMesh();
        newGS.geometry = this.geometry.clone();
        newGS.material = (this.material as Material).clone();

        newGS._vertexCount = this._vertexCount;
        newGS._copyTextures(this);
        newGS._splatPositions = this._splatPositions;
        newGS._readyToDisplay = false;
        newGS._instanciateWorker();

        newGS._vertexCount = newGS._vertexCount;
        return newGS;
    }

    private _tempQuaternion = new Quaternion();
    private _tempPosition = new Vector3();
    private _tempScale = new Vector3();
    private _tempColor = new Uint8Array(4);
    private _tempMatrix = new Matrix4();

    private _makeSplatFromComonents(
        sourceIndex: number,
        destinationIndex: number,
        position: Vector3,
        scale: Vector3,
        quaternion: Quaternion,
        color: Uint8Array,
        covA: Uint16Array,
        covB: Uint16Array,
        colorArray: Uint8Array,
        minimum: Vector3,
        maximum: Vector3,
    ): void {
        quaternion.w = -quaternion.w; // flip the quaternion to match the right handed system
        scale = scale.multiplyScalar(2); // we need to convert it to the geometry space (-2, 2)

        const te = this._tempMatrix.elements;

        const covBSItemSize = this._useRGBACovariants ? 4 : 2;

        this._splatPositions![4 * sourceIndex + 0] = position.x;
        this._splatPositions![4 * sourceIndex + 1] = position.y;
        this._splatPositions![4 * sourceIndex + 2] = position.z;

        this._splatPositions2![4 * sourceIndex + 0] = position.x;
        this._splatPositions2![4 * sourceIndex + 1] = position.y;
        this._splatPositions2![4 * sourceIndex + 2] = position.z;

        minimum.min(position);
        maximum.max(position);

        // matrixRotation.makeRotationFromQuaternion(quaternion);
        // matrixScale.makeScale(scale.x, scale.y, scale.z);
        // const M = new Matrix4().multiplyMatrices(matrixScale, matrixRotation).elements;

        // // compute manually the matrix to avoid the overhead of the matrix multiplication
        const x = quaternion.x,
            y = quaternion.y,
            z = quaternion.z,
            w = quaternion.w;
        const x2 = x + x,
            y2 = y + y,
            z2 = z + z;
        const xx = x * x2,
            xy = x * y2,
            xz = x * z2;
        const yy = y * y2,
            yz = y * z2,
            zz = z * z2;
        const wx = w * x2,
            wy = w * y2,
            wz = w * z2;
        const sx = scale.x,
            sy = scale.y,
            sz = scale.z;
        te[0] = (1 - (yy + zz)) * sx;
        te[1] = (xy + wz) * sy;
        te[2] = (xz - wy) * sz;
        te[4] = (xy - wz) * sx;
        te[5] = (1 - (xx + zz)) * sy;
        te[6] = (yz + wx) * sz;
        te[8] = (xz + wy) * sx;
        te[9] = (yz - wx) * sy;
        te[10] = (1 - (xx + yy)) * sz;
        const M = te;

        const covariances = this._tmpCovariances;
        covariances[0] = M[0] * M[0] + M[1] * M[1] + M[2] * M[2];
        covariances[1] = M[0] * M[4] + M[1] * M[5] + M[2] * M[6];
        covariances[2] = M[0] * M[8] + M[1] * M[9] + M[2] * M[10];
        covariances[3] = M[4] * M[4] + M[5] * M[5] + M[6] * M[6];
        covariances[4] = M[4] * M[8] + M[5] * M[9] + M[6] * M[10];
        covariances[5] = M[8] * M[8] + M[9] * M[9] + M[10] * M[10];

        // normalize covA, covB
        let factor = -10000;
        for (let covIndex = 0; covIndex < 6; covIndex++) {
            factor = Math.max(factor, Math.abs(covariances[covIndex]));
        }

        this._splatPositions![4 * sourceIndex + 3] = factor;
        this._splatPositions2![4 * sourceIndex + 3] = factor;
        const transform = factor;

        covA[destinationIndex * 4 + 0] = ToHalfFloat(covariances[0] / transform);
        covA[destinationIndex * 4 + 1] = ToHalfFloat(covariances[1] / transform);
        covA[destinationIndex * 4 + 2] = ToHalfFloat(covariances[2] / transform);
        covA[destinationIndex * 4 + 3] = ToHalfFloat(covariances[3] / transform);
        covB[destinationIndex * covBSItemSize + 0] = ToHalfFloat(covariances[4] / transform);
        covB[destinationIndex * covBSItemSize + 1] = ToHalfFloat(covariances[5] / transform);

        // colors
        colorArray[destinationIndex * 4 + 0] = color[0];
        colorArray[destinationIndex * 4 + 1] = color[1];
        colorArray[destinationIndex * 4 + 2] = color[2];
        colorArray[destinationIndex * 4 + 3] = color[3];
    }

    private _makeSplatFromAttribute(
        sourceIndex: number,
        destinationIndex: number,
        positionBuffer: BufferAttribute | InterleavedBufferAttribute,
        scaleBuffer: BufferAttribute | InterleavedBufferAttribute,
        rotationBuffer: BufferAttribute | InterleavedBufferAttribute,
        colorBuffer: BufferAttribute | InterleavedBufferAttribute,
        opacityBuffer: BufferAttribute | InterleavedBufferAttribute,
        covA: Uint16Array,
        covB: Uint16Array,
        colorArray: Uint8Array,
        minimum: Vector3,
        maximum: Vector3,
        colorIsFloat: boolean = false
    ): void {
        const i = sourceIndex;

        const position = this._tempPosition;
        const quaternion = this._tempQuaternion;
        const scale = this._tempScale;
        const color = this._tempColor;

        const colorScale = colorIsFloat ? 255 : 1;

        position.x = positionBuffer.getX(i);
        position.y = positionBuffer.getY(i);
        position.z = positionBuffer.getZ(i);
        scale.x = scaleBuffer.getX(i);
        scale.y = scaleBuffer.getY(i);
        scale.z = scaleBuffer.getZ(i);
        quaternion.x = rotationBuffer.getX(i);
        quaternion.y = rotationBuffer.getY(i);
        quaternion.z = rotationBuffer.getZ(i);
        quaternion.w = rotationBuffer.getW(i);
        quaternion.normalize();
        color[0] = colorBuffer.getX(i) * colorScale;
        color[1] = colorBuffer.getY(i) * colorScale;
        color[2] = colorBuffer.getZ(i) * colorScale;
        color[3] = (opacityBuffer ? opacityBuffer.getX(i) : colorBuffer.getW(i) ) * colorScale;

        this._makeSplatFromComonents(sourceIndex, destinationIndex, position, scale, quaternion, color, covA, covB, colorArray, minimum, maximum);
    }

    private _makeSplatFromBuffer(sourceIndex: number, destinationIndex: number, fBuffer: Float32Array, uBuffer: Uint8Array, covA: Uint16Array, covB: Uint16Array, colorArray: Uint8Array, minimum: Vector3, maximum: Vector3): void {
        const position = this._tempPosition;
        const quaternion = this._tempQuaternion;
        const scale = this._tempScale;
        const color = this._tempColor;

        position.x = fBuffer[8 * sourceIndex + 0];
        position.y = fBuffer[8 * sourceIndex + 1];
        position.z = fBuffer[8 * sourceIndex + 2];

        scale.x = fBuffer[8 * sourceIndex + 3 + 0];
        scale.y = fBuffer[8 * sourceIndex + 3 + 1];
        scale.z = fBuffer[8 * sourceIndex + 3 + 2];

        quaternion.x = (uBuffer[32 * sourceIndex + 28 + 1] - 127.5) / 127.5;
        quaternion.y = (uBuffer[32 * sourceIndex + 28 + 2] - 127.5) / 127.5;
        quaternion.z = (uBuffer[32 * sourceIndex + 28 + 3] - 127.5) / 127.5;
        quaternion.w = (uBuffer[32 * sourceIndex + 28 + 0] - 127.5) / 127.5;
        quaternion.normalize();

        color[0] = uBuffer[32 * sourceIndex + 24 + 0];
        color[1] = uBuffer[32 * sourceIndex + 24 + 1];
        color[2] = uBuffer[32 * sourceIndex + 24 + 2];
        color[3] = uBuffer[32 * sourceIndex + 24 + 3];

        this._makeSplatFromComonents(sourceIndex, destinationIndex, position, scale, quaternion, color, covA, covB, colorArray, minimum, maximum);
    }

    private _updateTextures(covA: Uint16Array, covB: Uint16Array, colorArray: Uint8Array, sh?: Uint8Array[]): void {
        const textureSize = this._getTextureSize(this._vertexCount);
        // Update the textures
        const createTextureFromData = (data: Float32Array, width: number, height: number, format: PixelFormat) => {
            const texture = new DataTexture(data, width, height, format, FloatType, UVMapping, ClampToEdgeWrapping, ClampToEdgeWrapping, LinearFilter, LinearFilter);
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            return texture;
        };

        const createTextureFromDataU8 = (data: Uint8Array, width: number, height: number, format: PixelFormat) => {
            const texture = new DataTexture(data, width, height, format, UnsignedByteType, UVMapping, ClampToEdgeWrapping, ClampToEdgeWrapping, LinearFilter, LinearFilter);
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            return texture;
        };

        const createTextureFromDataU32 = (data: Uint32Array, width: number, height: number, format: PixelFormat) => {
            const texture = new DataTexture(data, width, height, format, UnsignedIntType, UVMapping, ClampToEdgeWrapping, ClampToEdgeWrapping, NearestFilter, NearestFilter);
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            return texture;
        };

        const createTextureFromDataF16 = (data: Uint16Array, width: number, height: number, format: PixelFormat) => {
            const texture = new DataTexture(data, width, height, format, HalfFloatType, UVMapping, ClampToEdgeWrapping, ClampToEdgeWrapping, LinearFilter, LinearFilter);
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            return texture;
        };

        {
            this._covariancesATexture = createTextureFromDataF16(covA, textureSize.x, textureSize.y, RGBAFormat);
            this._covariancesBTexture = createTextureFromDataF16(covB, textureSize.x, textureSize.y, this._useRGBACovariants ? RGBAFormat : RGFormat);
            this._centersTexture = createTextureFromData(this._splatPositions!, textureSize.x, textureSize.y, RGBAFormat);
            this._colorsTexture = createTextureFromDataU8(colorArray, textureSize.x, textureSize.y, RGBAFormat);
            if (sh) {
                this._shTextures = [];
                sh.forEach((shData) => {
                    const buffer = new Uint32Array(shData.buffer);
                    const shTexture = createTextureFromDataU32(buffer, textureSize.x, textureSize.y, RGBAIntegerFormat);
                    shTexture.wrapS = ClampToEdgeWrapping;
                    shTexture.wrapT = ClampToEdgeWrapping;
                    this._shTextures!.push(shTexture);
                });
            }

            this._instanciateWorker();
        }
    }

    private _updateBoundingInfo(minimum: Vector3, maximum: Vector3): void {
        this.boundingBox = new Box3(minimum, maximum);
        this.boundingSphere = this.boundingBox.getBoundingSphere(new Sphere());
    }

    private *_updateData(data: ArrayBuffer, isAsync: boolean, sh?: Uint8Array[]): Coroutine<void> {
        // if a covariance texture is present, then it's not a creation but an update
        if (!this._covariancesATexture) {
            this._readyToDisplay = false;
        }

        // Parse the data
        const uBuffer = new Uint8Array(data);
        const fBuffer = new Float32Array(uBuffer.buffer);

        if (this._keepInRam) {
            this._splatsData = data;
            if (sh) {
                this._sh = sh;
            }
        }

        // degree == 1 for 1 texture (3 terms), 2 for 2 textures(8 terms) and 3 for 3 textures (15 terms)
        this._shDegree = sh ? sh.length : 0;
        const vertexCount = uBuffer.length / GaussianSplattingMesh._RowOutputLength;
        if (vertexCount != this._vertexCount) {
            this._vertexCount = vertexCount;
            this.geometry = GaussianSplattingGeometry.build(this._vertexCount);
            this.material = GaussianSplattingMaterial.build(this._shDegree);

            this._updateSplatIndexBuffer(this._vertexCount);
        }

        const textureSize = this._getTextureSize(vertexCount);
        const textureLength = textureSize.x * textureSize.y;
        const lineCountUpdate = textureSize.y;
        const textureLengthPerUpdate = textureSize.x * lineCountUpdate;

        this._splatPositions = new Float32Array(4 * textureLength);
        this._splatPositions2 = new Float32Array(4 * vertexCount);
        const covA = new Uint16Array(textureLength * 4);
        const covB = new Uint16Array((this._useRGBACovariants ? 4 : 2) * textureLength);
        const colorArray = new Uint8Array(textureLength * 4);

        const minimum = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        const maximum = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

        {
            for (let i = 0; i < vertexCount; i++) {
                this._makeSplatFromBuffer(i, i, fBuffer, uBuffer, covA, covB, colorArray, minimum, maximum);
                if (isAsync && i % GaussianSplattingMesh._SplatBatchSize === 0) {
                    yield;
                }
            }
            // textures
            this._updateTextures(covA, covB, colorArray, sh);
            // Update the binfo
            this._updateBoundingInfo(minimum, maximum);
            this.setEnabled(true);
        }
        this._postToWorker(true);
    }

    /**
     * Update asynchronously the buffer
     * @param data array buffer containing center, color, orientation and scale of splats
     * @param sh optional array of uint8 array for SH data
     * @returns a promise
     */
    public async updateDataAsync(data: ArrayBuffer, sh?: Uint8Array[]): Promise<void> {
        return runCoroutineAsync(this._updateData(data, true, sh), createYieldingScheduler());
    }

    /**
     * @experimental
     * Update data from GS (position, orientation, color, scaling)
     * @param data array that contain all the datas
     * @param sh optional array of uint8 array for SH data
     */
    public updateData(data: ArrayBuffer, sh?: Uint8Array[]): void {
        runCoroutineSync(this._updateData(data, false, sh));
    }

    private *_updateDataFromGeometry(geometry: BufferGeometry, isAsync: boolean): Coroutine<void> {
        // if a covariance texture is present, then it's not a creation but an update
        if (!this._covariancesATexture) {
            this._readyToDisplay = false;
        }
        const positionBuffer = geometry.getAttribute('position');
        const scaleBuffer = geometry.getAttribute('scale');
        const colorBuffer = geometry.getAttribute('color');
        const opacityBuffer = geometry.getAttribute('opacity');
        const rotationBuffer = geometry.getAttribute('rotation');

        let colorIsFloat = colorBuffer.array instanceof Float32Array;
        let colorNormalized = colorBuffer.normalized;
        colorBuffer.normalized = false;

        this._shDegree = 0;
        const vertexCount = positionBuffer.count;
        if (vertexCount != this._vertexCount) {
            this._vertexCount = vertexCount;
            this.geometry = GaussianSplattingGeometry.build(this._vertexCount);
            this.material = GaussianSplattingMaterial.build(this._shDegree);

            this._updateSplatIndexBuffer(this._vertexCount);
        }

        const textureSize = this._getTextureSize(vertexCount);
        const textureLength = textureSize.x * textureSize.y;
        const lineCountUpdate = textureSize.y;
        const textureLengthPerUpdate = textureSize.x * lineCountUpdate;

        this._splatPositions = new Float32Array(4 * textureLength);
        this._splatPositions2 = new Float32Array(4 * vertexCount);
        const covA = new Uint16Array(textureLength * 4);
        const covB = new Uint16Array((this._useRGBACovariants ? 4 : 2) * textureLength);
        const colorArray = new Uint8Array(textureLength * 4);

        const minimum = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        const maximum = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

        {
            for (let i = 0; i < vertexCount; i++) {
                this._makeSplatFromAttribute(i, i, positionBuffer, scaleBuffer, rotationBuffer, colorBuffer, opacityBuffer, covA, covB, colorArray, minimum, maximum, colorIsFloat);
                if (isAsync && i % GaussianSplattingMesh._SplatBatchSize === 0) {
                    yield;
                }
            }
            // textures
            this._updateTextures(covA, covB, colorArray);
            // Update the binfo
            this._updateBoundingInfo(minimum, maximum);
            this.setEnabled(true);
        }

        colorBuffer.normalized = colorNormalized;

        this._postToWorker(true);
    }

    /**
     * Update asynchronously the buffer from geometry
     * @param geometry array buffer containing center, color, orientation and scale of splats
     * @returns a promise
     */
    public updateDataFromGeometryAsync(geometry: BufferGeometry): Promise<void> {
        return runCoroutineAsync(this._updateDataFromGeometry(geometry, true), createYieldingScheduler());
    }

    public sortDataAsync(camera: Camera, forced: boolean = false): Promise<void> {
        if (!this._worker || !camera) {
            return Promise.resolve();
        }

        this._cameraMatrix = camera.matrixWorldInverse;

        const promise = this._postToWorker(forced);
        return promise ? promise : Promise.resolve();
    }

    /**
     * @experimental
     * Update data from geometry (position, orientation, color, scaling)
     * @param geometry array that contain all the datas
     */
    public updateDataFromGeometry(geometry: BufferGeometry): void {
        runCoroutineSync(this._updateDataFromGeometry(geometry, false));
    }

    // in case size is different
    private _updateSplatIndexBuffer(vertexCount: number): void {
        if (!this._splatIndex || vertexCount > this._splatIndex.length) {
            this._splatIndex = new Float32Array(vertexCount);

            for (let j = 0; j < vertexCount; j++) {
                this._splatIndex[j] = j;
            }

            (this.geometry.attributes.splatIndex as BufferAttribute).set(this._splatIndex);
            this.geometry.attributes.splatIndex.needsUpdate = true;
        }
        (this.geometry as InstancedBufferGeometry).instanceCount = vertexCount;
    }

    private _instanciateWorker(): void {
        if (!this._vertexCount) {
            return;
        }
        this._updateSplatIndexBuffer(this._vertexCount);

        // Start the worker thread
        this._worker?.terminate();
        this._worker = new GaussianSplattingSorter();

        const positions = this._splatPositions2!;
        const vertexCount = this._vertexCount;

        this._worker.init(positions, vertexCount);
        this._canPostToWorker = true;

        this._worker.onmessage = (splatIndex) => {
            if (this._splatIndex && splatIndex) {
                for (let j = 0; j < this._vertexCount; j++) {
                    this._splatIndex[j] = splatIndex[j];
                }
                (this.geometry.attributes.splatIndex as BufferAttribute).set(this._splatIndex);
            }

            this.geometry.attributes.splatIndex.needsUpdate = true;
            this._canPostToWorker = true;
            this._readyToDisplay = true;
            // sort is dirty when GS is visible for progressive update with a this message arriving but positions were partially filled
            // another update needs to be kicked. The kick can't happen just when the position buffer is ready because _canPostToWorker might be false.
            if (this._sortIsDirty) {
                this._postToWorker(true);
                this._sortIsDirty = false;
            }
        };
    }

    private _getTextureSize(length: number): Vector2 {
        const maxTextureSize = 4096; // @TODO: Use 'capabilities.maxTextureSize'
        const width = maxTextureSize;

        let height = 1;

        // TODO: check engine version and WebGPU support
        // if (engine.version === 1 && !engine.isWebGPU) {
        while (width * height < length) {
            height *= 2;
        }
        // } else {
        //     height = Math.ceil(length / width);
        // }

        if (height > width) {
            console.error("GaussianSplatting texture size: (" + width + ", " + height + "), maxTextureSize: " + width);
            height = width;
        }

        return new Vector2(width, height);
    }
}

"use strict";

async function main() {
    // ------------------------------------------------------------
    // WebGPU bootstrap:
    // - Grab GPU adapter/device
    // - Configure the canvas context with the preferred swapchain format
    // ------------------------------------------------------------
    const gpu = navigator.gpu;
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('my-canvas');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    // ------------------------------------------------------------
    // Scene geometry (all in one position array):
    // 0..3   = ground quad (2 triangles)
    // 4..7   = quad A (2 triangles)
    // 8..11  = quad B (2 triangles)
    // ------------------------------------------------------------
    let positions = [
        // Ground quad
        vec3(-2, -1, -1),
        vec3(2, -1, -1),
        vec3(2, -1, -5),
        vec3(-2, -1, -5),
        // Quad A
        vec3(0.25, -0.5, -1.25),
        vec3(0.75, -0.5, -1.25),
        vec3(0.75, -0.5, -1.75),
        vec3(0.25, -0.5, -1.75),
        // Quad B
        vec3(-1, -1, -2.5),
        vec3(-1, -1, -3.0),
        vec3(-1, 0, -3.0),
        vec3(-1, 0, -2.5),
    ];

    // ------------------------------------------------------------
    // Index buffer:
    // - First 6 indices render the ground quad
    // - Remaining indices render the two red quads (objects)
    // ------------------------------------------------------------
    let indices = new Uint32Array([
        // Ground quad
        0, 1, 2,
        0, 2, 3,
        // Quad A
        4, 5, 6,
        4, 6, 7,
        // Quad B
        8, 9, 10,
        8, 10, 11,
    ]);

    // ------------------------------------------------------------
    // Vertex position buffer + layout description for the pipeline
    // shaderLocation(0) matches @location(0) in the vertex shader
    // ------------------------------------------------------------
    const positionBuffer = device.createBuffer({
        size: sizeof['vec3'] * positions.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const positionBufferLayout = {
        arrayStride: sizeof['vec3'],
        attributes: [{
            format: 'float32x3',
            offset: 0,
            shaderLocation: 0,
        }],
    };

    // ------------------------------------------------------------
    // Index buffer on the GPU
    // NOTE: The size used here mirrors your code as-is.
    // ------------------------------------------------------------
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * indices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // ------------------------------------------------------------
    // UVs:
    // Same 0..1 UV mapping repeated for each quad (ground/A/B)
    // shaderLocation(1) matches @location(1) in the vertex shader
    // ------------------------------------------------------------
    const texcoords = [
        // Ground quad
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
        // Quad A
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
        // Quad B
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
    ];
    const texcoordBuffer = device.createBuffer({
        size: sizeof['vec2'] * texcoords.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const texcoordBufferLayout = {
        arrayStride: sizeof['vec2'],
        attributes: [{
            format: 'float32x2',
            offset: 0,
            shaderLocation: 1,
        }],
    };

    // ------------------------------------------------------------
    // Upload initial geometry + UVs to the GPU
    // ------------------------------------------------------------
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);
    device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

    // ------------------------------------------------------------
    // Load ground texture (xamp23.png) from your folder structure
    // ------------------------------------------------------------
    const filename = '../textures/xamp23.png';
    const response = await fetch(filename);
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    // ------------------------------------------------------------
    // Ground texture GPU resource + upload pixels
    // ------------------------------------------------------------
    const textureGround = device.createTexture({
        size: [img.width, img.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source: img, flipY: true },
        { texture: textureGround },
        { width: img.width, height: img.height },
    );

    // ------------------------------------------------------------
    // Sampler for ground texture (clamp + linear filtering)
    // ------------------------------------------------------------
    textureGround.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
    });

    // ------------------------------------------------------------
    // A 1x1 solid red texture for the object quads + their shadows
    // ------------------------------------------------------------
    const textureRed = device.createTexture({
        size: [1, 1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
    });
    device.queue.writeTexture(
        { texture: textureRed },
        new Uint8Array([255, 0, 0, 255]), // A single red pixel
        { offset: 0, bytesPerRow: 4, rowsPerImage: 1 },
        [1, 1, 1]
    );

    // ------------------------------------------------------------
    // Sampler for the red texture
    // ------------------------------------------------------------
    textureRed.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'nearest',
        magFilter: 'linear',
    });

    // ------------------------------------------------------------
    // Background clear color (currently white in your code)
    // ------------------------------------------------------------
    const bgcolor = vec4(1.0, 1.0, 1.0, 1.0) // Cornflower

    // ------------------------------------------------------------
    // Uniform buffers:
    // - uniformBuffer        -> for normal rendering (ground + objects)
    // - uniformBufferShadow  -> for shadow projection pass
    // Layout matches WGSL: { mvp, visibility } with padding to 16B
    // ------------------------------------------------------------
    const uniformBuffer = device.createBuffer({
        size: sizeof['mat4'] + 4 * 4, // Extra 4 bytes for visibility. Need to add padding to 16 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformBufferShadow = device.createBuffer({
        size: sizeof['mat4'] + 4 * 4, // Extra 4 bytes for visibility. Need to add padding to 16 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ------------------------------------------------------------
    // Depth fix matrix (WebGPU clip-space z is [0..1])
    // ------------------------------------------------------------
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    // ------------------------------------------------------------
    // Model transform (identity via translate(0,0,0))
    // ------------------------------------------------------------
    const center = translate(0, 0, 0);
    const M = center;

    // ------------------------------------------------------------
    // Projection setup:
    // perspective(fov, aspect, near, far) then apply depth-fix Mst
    // ------------------------------------------------------------
    const fov = 90;
    let projection = perspective(fov, canvas.width / canvas.height, 1, 20);
    projection = mult(Mst, projection);

    // ------------------------------------------------------------
    // View matrix is identity here (camera at origin, looking down -Z)
    // ------------------------------------------------------------
    const V = mat4();

    // ------------------------------------------------------------
    // Base MVP used for ground and objects (before any shadow matrix)
    // ------------------------------------------------------------
    const mvp = mult(projection, mult(V, M));

    // ------------------------------------------------------------
    // Upload MVP + visibility for normal pass
    // visibility = 1.0 means "no darkening"
    // ------------------------------------------------------------
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
    device.queue.writeBuffer(uniformBuffer, sizeof['mat4'], new Float32Array([1.0]));

    // ------------------------------------------------------------
    // Load WGSL shader code from <script id="wgsl" src="...">
    // ------------------------------------------------------------
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    // ------------------------------------------------------------
    // MSAA configuration (4x)
    // ------------------------------------------------------------
    const msaaCount = 4;

    // ------------------------------------------------------------
    // Main pipeline:
    // - Normal depth test (less)
    // - Back-face culling for regular drawing
    // ------------------------------------------------------------
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout, texcoordBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }],
        },
        primitive: {
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'back',
        },
        multisample: { count: msaaCount },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    // ------------------------------------------------------------
    // Shadow pipeline:
    // - Uses blending (alpha) so shadow polygons can be semi-transparent
    // - Uses depthCompare 'greater' to avoid drawing shadow where the
    //   caster is in front (matches your "depth-culling" approach)
    // - No culling so shadows can appear regardless of winding
    // ------------------------------------------------------------
    const pipelineShadows = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout, texcoordBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{
                format: canvasFormat,
                blend: {
                    color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'zero' },
                }
            }],
        },
        primitive: {
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'none', // No culling to see shadows on ground on both sides
        },
        multisample: { count: msaaCount },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'greater',
            format: 'depth24plus',
        },
    });

    // ------------------------------------------------------------
    // MSAA color buffer (resolved into swapchain each frame)
    // ------------------------------------------------------------
    const msaaTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: canvasFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // ------------------------------------------------------------
    // Depth buffer (shared across passes in the single render pass)
    // ------------------------------------------------------------
    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // ------------------------------------------------------------
    // Bind groups:
    // - Ground uses ground texture
    // - Shadows use red texture + shadow uniform buffer
    // - Objects use red texture + normal uniform buffer
    // ------------------------------------------------------------
    const bindGroupGround = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: textureGround.sampler },
            { binding: 2, resource: textureGround.createView() },
        ],
    });

    const bindGroupShadows = device.createBindGroup({
        layout: pipelineShadows.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBufferShadow } },
            { binding: 1, resource: textureRed.sampler },
            { binding: 2, resource: textureRed.createView() },
        ],
    });

    const bindGroupObjects = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: textureRed.sampler },
            { binding: 2, resource: textureRed.createView() },
        ],
    });

    // ------------------------------------------------------------
    // Animation toggle:
    // When enabled, updates the light position angle and re-renders.
    // ------------------------------------------------------------
    let shouldAnimate = false;
    document.getElementById('toggle-animate').onclick = () => {
        shouldAnimate = !shouldAnimate;
        if (shouldAnimate) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };
    let angle = 90;

    function render() {
        // ------------------------------------------------------------
        // Build the planar shadow projection matrix for plane y = -1:
        // - Light position l moves on a circle
        // - Plane normal n = (0,1,0)
        // - Plane distance encoded via d and epsilon tweak
        // ------------------------------------------------------------
        const epsilon = 0.0001;
        const r = 2.0;
        const l = vec3(r * Math.sin(angle), 2, -2 + r * Math.cos(angle));
        const n = vec3(0, 1, 0);
        const d = 1.0 + epsilon;

        // ------------------------------------------------------------
        // Compute shadow matrix components (classic planar shadow matrix)
        // ------------------------------------------------------------
        const a = d + dot(n, l);
        const Mshadow = mat4(
            a - l[0] * n[0], -l[0] * n[1], -l[0] * n[2], -l[0] * d,
            -l[1] * n[0], a - l[1] * n[1], -l[1] * n[2], -l[1] * d,
            -l[2] * n[0], -l[2] * n[1], a - l[2] * n[2], -l[2] * d,
            -n[0], -n[1], -n[2], a - d
        );

        // ------------------------------------------------------------
        // Shadow MVP:
        // Applies the shadow projection before rasterizing the object
        // geometry as "shadow polygons".
        // ------------------------------------------------------------
        const mvpShadow = mult(projection, mult(V, Mshadow));

        // ------------------------------------------------------------
        // Upload shadow MVP + visibility for the shadow pass
        // visibility = 0.0 here means the shader can output "dark"
        // (depending on WGSL logic that multiplies by visibility)
        // ------------------------------------------------------------
        device.queue.writeBuffer(uniformBufferShadow, 0, flatten(mvpShadow));
        device.queue.writeBuffer(uniformBufferShadow, sizeof['mat4'], new Float32Array([0.0]));

        // ------------------------------------------------------------
        // Begin render pass (single pass, multiple pipeline switches)
        // ------------------------------------------------------------
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: msaaTexture.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: bgcolor[0], g: bgcolor[1], b: bgcolor[2], a: bgcolor[3] },
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthLoadOp: "clear",
                depthClearValue: 1.0,
                depthStoreOp: "store",
            }
        });

        // ------------------------------------------------------------
        // Common state for all draws:
        // - Index buffer
        // - Position buffer at slot 0
        // - UV buffer at slot 1
        // ------------------------------------------------------------
        pass.setPipeline(pipeline);
        pass.setIndexBuffer(indicesBuffer, 'uint32');
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, texcoordBuffer);

        // ------------------------------------------------------------
        // 1) Draw ground (first 6 indices)
        // ------------------------------------------------------------
        pass.setBindGroup(0, bindGroupGround);
        pass.drawIndexed(6);

        // ------------------------------------------------------------
        // 2) Draw shadow polygons (remaining indices, offset by 6)
        // Uses different pipeline (blend + depthCompare 'greater')
        // ------------------------------------------------------------
        pass.setPipeline(pipelineShadows);
        pass.setBindGroup(0, bindGroupShadows);
        pass.drawIndexed(indices.length - 6, 1, 6);

        // ------------------------------------------------------------
        // 3) Draw the real objects on top (same indices as shadows)
        // ------------------------------------------------------------
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroupObjects);
        pass.drawIndexed(indices.length - 6, 1, 6);

        // ------------------------------------------------------------
        // End pass + submit GPU work
        // ------------------------------------------------------------
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    // ------------------------------------------------------------
    // Animation loop (updates angle based on time delta)
    // ------------------------------------------------------------
    let lastTime = performance.now();

    function animate(timestamp) {
        angle += (timestamp - lastTime) * 0.0015;
        lastTime = timestamp;
        render();
        if (shouldAnimate) {
            requestAnimationFrame(animate);
        }
    }

    // ------------------------------------------------------------
    // Initial frame
    // ------------------------------------------------------------
    render();
}

window.onload = function () { main(); }

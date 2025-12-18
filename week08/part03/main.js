"use strict";

async function main() {
    // ------------------------------------------------------------
    // WebGPU bootstrapping:
    // - requestAdapter(): choose a GPU adapter (hardware/software)
    // - requestDevice(): get a logical device to create resources
    // - configure canvas context with the chosen device + format
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
    // Scene geometry:
    // positions = 3 quads (ground + two objects)
    // Layout in the array:
    //   0..3   : ground quad
    //   4..7   : quad A
    //   8..11  : quad B
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
    // Each quad is rendered as 2 triangles = 6 indices.
    // Ordering here matches the positions layout above.
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
    // GPU buffers:
    // - positionBuffer: vertex positions (vec3)
    // - indicesBuffer : element indices (uint32)
    // Also define vertex buffer layout used by the pipeline.
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
    // Index buffer (note: size uses sizeof['vec3'] * indices.length in this code)
    // The intent is: allocate enough bytes for all indices and upload them.
    // ------------------------------------------------------------
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * indices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // ------------------------------------------------------------
    // Texture coordinates:
    // One UV per vertex.
    // Here we reuse the same (0..1) UV mapping for every quad.
    // ------------------------------------------------------------
    // Create texture coordinate buffer
    // These coords map the texture directly to the quad
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
    // Upload CPU arrays into GPU buffers
    // ------------------------------------------------------------
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);
    device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

    // ------------------------------------------------------------
    // Ground texture loading:
    // - fetch PNG file
    // - createImageBitmap for efficient upload
    // - copyExternalImageToTexture to the GPU texture
    // ------------------------------------------------------------
    // Load ground texture
    const filename = '../textures/xamp23.png';
    const response = await fetch(filename);
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    const textureGround = device.createTexture({
        size: [img.width, img.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source: img, flipY: true },        // flipY aligns image origin with typical UV convention
        { texture: textureGround },
        { width: img.width, height: img.height },
    );

    // ------------------------------------------------------------
    // Ground sampler:
    // clamp-to-edge prevents repeating beyond [0,1]
    // linear filtering smooths when scaling
    // ------------------------------------------------------------
    textureGround.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
    });

    // ------------------------------------------------------------
    // Solid red texture for the objects:
    // 1x1 texture filled with a single red RGBA pixel.
    // Useful as a constant "material" without loading an image.
    // ------------------------------------------------------------
    // Create red texture
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
    textureRed.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'nearest', // nearest keeps the single texel crisp (though it's constant anyway)
        magFilter: 'linear',
    });

    // ------------------------------------------------------------
    // Clear color for the framebuffer
    // ------------------------------------------------------------
    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower

    // ------------------------------------------------------------
    // Uniform buffers:
    // - uniformBuffer: main MVP + visibility (as extra data)
    // - uniformBufferShadow: shadow MVP + visibility
    //
    // NOTE: This code allocates extra bytes and mentions padding:
    // uniform buffers are aligned to 16-byte chunks in WGSL layouts.
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
    // WebGPU depth fix matrix (OpenGL-style clip z -> WebGPU [0,1] depth)
    // ------------------------------------------------------------
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    // ------------------------------------------------------------
    // Basic transforms:
    // - model M: identity/center (no object transform)
    // - view  V: identity (camera at default)
    // - projection: perspective with depth fix Mst applied
    // ------------------------------------------------------------
    const center = translate(0, 0, 0);
    const M = center;

    const fov = 90;
    let projection = perspective(fov, canvas.width / canvas.height, 1, 20);
    projection = mult(Mst, projection);

    const V = mat4();
    const mvp = mult(projection, mult(V, M));

    // ------------------------------------------------------------
    // Upload initial main uniforms:
    // - MVP matrix at offset 0
    // - visibility value at offset sizeof(mat4)
    // ------------------------------------------------------------
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
    device.queue.writeBuffer(uniformBuffer, sizeof['mat4'], new Float32Array([1.0]));

    // ------------------------------------------------------------
    // Load WGSL shader source referenced by <script id="wgsl" ...>
    // and create a shader module.
    // ------------------------------------------------------------
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    // ------------------------------------------------------------
    // MSAA sample count (4x multisampling)
    // ------------------------------------------------------------
    const msaaCount = 4;

    // ------------------------------------------------------------
    // Main render pipeline:
    // - uses main_vs/main_fs from WGSL
    // - no culling so we can see both sides if needed
    // - depth test: "less" (standard)
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
            cullMode: 'none', // No culling to see shadows on ground on both sides
        },
        multisample: { count: msaaCount },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    // ------------------------------------------------------------
    // Shadow render pipeline:
    // Same shader entry points, but different depth compare:
    // - depthCompare: "greater" to implement a depth-based “culling” trick
    // ------------------------------------------------------------
    // Create another pipeline for shadow pass to change depth test
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
            targets: [{ format: canvasFormat }],
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
    // MSAA color buffer + MSAA depth buffer
    // - msaaTexture: multisampled color target, resolved into swapchain texture
    // - depthTexture: multisampled depth attachment
    // ------------------------------------------------------------
    const msaaTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: canvasFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // ------------------------------------------------------------
    // Bind groups:
    // Each bind group selects which uniform buffer + sampler + texture
    // will be used for that draw.
    //
    // - bindGroupGround  : ground uses ground texture
    // - bindGroupObjects : objects use red texture
    // - bindGroupShadows : shadow pass uses shadow uniform buffer
    // ------------------------------------------------------------
    // Different bind groups for ground and objects to use different textures
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
    // When enabled, requestAnimationFrame drives updates.
    // ------------------------------------------------------------
    let shouldAnimate = false;
    document.getElementById('toggle-animate').onclick = () => {
        shouldAnimate = !shouldAnimate;
        if (shouldAnimate) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    // ------------------------------------------------------------
    // Light animation parameter:
    // angle is updated over time to move the point light in a circle.
    // ------------------------------------------------------------
    let angle = 90;

    function render() {
        // ------------------------------------------------------------
        // Build planar projection shadow matrix (Mshadow):
        // This projects geometry onto the ground plane given a point light.
        //
        // - epsilon: tiny offset to reduce z-fighting with the ground
        // - l: moving light position
        // - n: plane normal (ground plane normal = (0,1,0))
        // - d: plane constant (plane y = -1 => n·x + d = 0 with d = 1)
        // ------------------------------------------------------------
        // Shadow uniform buffer
        const epsilon = 0.0001;
        const r = 2.0;
        const l = vec3(r * Math.sin(angle), 2, -2 + r * Math.cos(angle));
        const n = vec3(0, 1, 0);
        const d = 1.0 + epsilon;

        // ------------------------------------------------------------
        // a = d + dot(n, l) is the common term for the projection matrix
        // ------------------------------------------------------------
        const a = d + dot(n, l);

        // ------------------------------------------------------------
        // 4x4 shadow projection matrix for plane (n,d) and light position l
        // Produces "flattened" projected geometry onto the plane.
        // ------------------------------------------------------------
        const Mshadow = mat4(
            a - l[0] * n[0], -l[0] * n[1], -l[0] * n[2], -l[0] * d,
            -l[1] * n[0], a - l[1] * n[1], -l[1] * n[2], -l[1] * d,
            -l[2] * n[0], -l[2] * n[1], a - l[2] * n[2], -l[2] * d,
            -n[0], -n[1], -n[2], a - d
        );

        // ------------------------------------------------------------
        // Shadow MVP:
        // Apply projection * view * Mshadow (model is baked into Mshadow usage here)
        // ------------------------------------------------------------
        const mvpShadow = mult(projection, mult(V, Mshadow));

        // ------------------------------------------------------------
        // Upload shadow uniforms:
        // - mvpShadow at offset 0
        // - visibility at offset sizeof(mat4) (0.0 => fully dark / depends on shader usage)
        // ------------------------------------------------------------
        device.queue.writeBuffer(uniformBufferShadow, 0, flatten(mvpShadow));
        device.queue.writeBuffer(uniformBufferShadow, sizeof['mat4'], new Float32Array([0.0]));

        // ------------------------------------------------------------
        // Begin render pass:
        // - clear MSAA target and depth buffer
        // - resolve MSAA to the current swapchain texture
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
        // Set shared geometry state once:
        // index buffer + both vertex buffers (position + UV)
        // ------------------------------------------------------------
        pass.setPipeline(pipeline);
        pass.setIndexBuffer(indicesBuffer, 'uint32');
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, texcoordBuffer);

        // ------------------------------------------------------------
        // 1) Draw ground (textured)
        // ------------------------------------------------------------
        pass.setBindGroup(0, bindGroupGround);
        pass.drawIndexed(6);

        // ------------------------------------------------------------
        // 2) Draw projected shadows (depthCompare "greater" pipeline)
        // Uses shadow uniforms + red texture (acts as shadow color in shader)
        // ------------------------------------------------------------
        pass.setPipeline(pipelineShadows);
        pass.setBindGroup(0, bindGroupShadows);
        pass.drawIndexed(indices.length - 6, 1, 6);

        // ------------------------------------------------------------
        // 3) Draw the actual objects (red)
        // Rendered after the shadows so objects appear on top.
        // ------------------------------------------------------------
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroupObjects);
        pass.drawIndexed(indices.length - 6, 1, 6);

        // ------------------------------------------------------------
        // Finish pass + submit GPU work
        // ------------------------------------------------------------
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    // ------------------------------------------------------------
    // Animation loop state
    // ------------------------------------------------------------
    let lastTime = performance.now();

    function animate(timestamp) {
        // ------------------------------------------------------------
        // Update the angle based on elapsed time:
        // gives a framerate-independent animation speed.
        // ------------------------------------------------------------
        angle += (timestamp - lastTime) * 0.0015;
        lastTime = timestamp;

        // Render the frame with updated light/shadow matrix
        render();

        // Continue if animation is enabled
        if (shouldAnimate) {
            requestAnimationFrame(animate);
        }
    }

    // Initial draw
    render();
}

window.onload = function () { main(); }

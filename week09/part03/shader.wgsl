struct Uniforms {
    // Camera MVP (View * Projection * Model) for the current draw
    mvp: mat4x4f,

    // Model matrix (object -> world), used for teapot and shadow pass
    model: mat4x4f,

    // Light View-Projection (world -> light clip), used to build shadow coords
    lightViewProj: mat4x4f,

    // Camera position (world space)
    eye: vec3f,

    // Padding/legacy slot (kept for alignment / compatibility)
    visibility: f32,

    // Point light position (world space)
    light_pos: vec3f,

    // Emitted radiance intensity scalar (white light)
    L_e: f32,

    // Ambient radiance intensity scalar
    L_a: f32,

    // Diffuse reflectance scalar
    k_d: f32,

    // Specular reflectance scalar
    k_s: f32,

    // Shininess exponent
    s: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Sampler + base color texture (ground uses xamp23; teapot may ignore)
@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;

// Shadow map stored as a color texture (rgba32float), depth in .r
@group(0) @binding(3) var shadowTexture: texture_2d<f32>;

// --------------------------------------------------------------------------
// GROUND
// --------------------------------------------------------------------------
struct VSOutGround {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
    @location(1) worldPos: vec4f,
};

@vertex
fn main_vs_ground(@location(0) inPos: vec3f, @location(3) texCoord: vec2f) -> VSOutGround {
    var vsOut: VSOutGround;

    // Ground is static; treat input position as world position directly
    let wp = vec4f(inPos, 1.0);

    // Camera MVP already includes the proper view/projection chain for this draw
    vsOut.position = uniforms.mvp * wp;

    // Pass UVs to fragment shader
    vsOut.texCoord = texCoord;

    // Pass world position so fragment shader can compute light-space coords
    vsOut.worldPos = wp;

    return vsOut;
}

@fragment
fn main_fs_ground(
    @location(0) texCoords: vec2f,
    @location(1) worldPos: vec4f
) -> @location(0) vec4f {
    // --- Shadow map lookup (world -> light clip -> shadow UV + depth) ---

    // World position in light clip space
    let p_clip_l = uniforms.lightViewProj * worldPos;

    // NDC = clip / w, then map x,y from [-1,1] to [0,1]
    // Y is flipped to match the texture coordinate convention used in JS
    let shadowCoords = vec3f(
        p_clip_l.x / p_clip_l.w * 0.5 + 0.5,
        -p_clip_l.y / p_clip_l.w * 0.5 + 0.5,
        p_clip_l.z / p_clip_l.w
    );

    // Sample stored depth (in .r) from the shadow texture using texel coordinates
    let depth = textureLoad(
        shadowTexture,
        vec2u(shadowCoords.xy * vec2f(2048.0, 2048.0)),
        0
    ).r;

    // Simple depth compare with bias to reduce acne
    let bias = 0.005;
    var vis = 1.0;
    if (shadowCoords.z > depth + bias) {
        vis = 0.4; // darken but keep visible (ambient-ish)
    }

    // Base color from ground texture, modulated by visibility
    let texColor = textureSample(ourTexture, ourSampler, texCoords);
    return vec4f(texColor.rgb * vis, 1.0);
}

// --------------------------------------------------------------------------
// TEAPOT
// --------------------------------------------------------------------------
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
};

@vertex
fn main_vs_teapot(
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f
) -> VSOut {
    var vsOut: VSOut;

    // Camera transform for rasterization
    vsOut.position = uniforms.mvp * inPos;

    // Pass through for lighting in fragment shader
    vsOut.inPos = inPos;
    vsOut.color = color;
    vsOut.normal = normal;

    return vsOut;
}

@fragment
fn main_fs_teapot(
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f
) -> @location(0) vec4f {
    // Unit normal (OBJ provides it per vertex)
    let n = normalize(normal.xyz);

    // --- Shadow test for teapot (self-shadowing) ---

    // Transform teapot world position into light clip space
    let p_clip_l = uniforms.lightViewProj * (uniforms.model * inPos);

    // Convert to [0,1] shadow UV + depth
    let shadowCoords = vec3f(
        p_clip_l.x / p_clip_l.w * 0.5 + 0.5,
        -p_clip_l.y / p_clip_l.w * 0.5 + 0.5,
        p_clip_l.z / p_clip_l.w
    );

    // Read stored depth from shadow map
    let depth = textureLoad(
        shadowTexture,
        vec2u(shadowCoords.xy * vec2f(2048.0, 2048.0)),
        0
    ).r;

    // Depth compare with bias
    let bias = 0.005;
    var vis = 1.0;
    if (shadowCoords.z > depth + bias) {
        vis = 0.4;
    }

    // --- Phong lighting (with “no back-side specular”) ---

    let k_d = vec3f(1.0) * uniforms.k_d;
    let k_a = k_d;
    let k_s = vec3f(1.0, 1.0, 1.0) * uniforms.k_s;

    // Point light direction in world space (from surface point to light)
    let l_e = -normalize(uniforms.light_pos - (uniforms.model * inPos).xyz);
    let omega_i = -l_e;

    // Radiance scalars (white light)
    let L_e = vec3f(1.0, 1.0, 1.0) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1.0, 1.0, 1.0) * uniforms.L_a;

    // View direction and perfect reflection direction
    let w_o = normalize(uniforms.eye - inPos.xyz);
    let w_r = 2.0 * dot(omega_i, n) * n - omega_i;

    // Specular + diffuse + ambient
    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);
    let L_rd   = k_d * L_e * max(dot(n, omega_i), 0.0);
    let L_ra   = k_a * L_a;

    // Prevent specular highlights on the back-facing side
    let L_P_rs_select = select(vec3f(0.0, 0.0, 0.0), L_P_rs, dot(n, omega_i) > 0.0);

    // Apply shadow visibility to direct lighting, keep ambient always
    let L_o = (L_rd + L_P_rs_select) * vis + L_ra;

    return vec4f(L_o, 1.0);
}

// --------------------------------------------------------------------------
// SHADOW DEPTH PASS
// --------------------------------------------------------------------------
@vertex
fn main_vs_depth(@location(0) inPos: vec4f) -> @builtin(position) vec4f {
    // Render from the light POV (lightViewProj * model)
    return uniforms.lightViewProj * uniforms.model * inPos;
}

@fragment
fn main_fs_depth(@builtin(position) fragcoord: vec4f) -> @location(0) vec4f {
    // Store current fragment depth (z) into the shadow texture (red channel)
    return vec4f(fragcoord.z, 0.0, 0.0, 1.0);
}

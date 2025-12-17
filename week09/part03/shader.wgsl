struct Uniforms {
    mvp: mat4x4f,
    model: mat4x4f,
    lightViewProj: mat4x4f, // Used for shadow coordinate generation
    eye: vec3f,
    visibility: f32, // Padding/Unused
    light_pos: vec3f,
    L_e: f32,
    L_a: f32,
    k_d: f32,
    k_s: f32,
    s: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;
@group(0) @binding(3) var shadowTexture: texture_2d<f32>; // The depth texture

// --------------------------------------------------------------------------
// GROUND
// --------------------------------------------------------------------------
struct VSOutGround {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
    @location(1) worldPos: vec4f,
}

@vertex
fn main_vs_ground(@location(0) inPos: vec3f, @location(3) texCoord: vec2f) -> VSOutGround {
    var vsOut: VSOutGround;
    // Ground is static, so Model matrix is Identity. We can use inPos as WorldPos directly.
    // uniforms.mvp already includes View*Proj.
    vsOut.position = uniforms.mvp * vec4f(inPos, 1.0);
    vsOut.texCoord = texCoord;
    vsOut.worldPos = vec4f(inPos, 1.0);
    return vsOut;
}

@fragment   
fn main_fs_ground(@location(0) texCoords: vec2f, @location(1) worldPos: vec4f) -> @location(0) vec4f {
    // 1. Calculate Shadow Coordinates
    // Transform World Pos -> Light Clip Space
    let p_clip_l = uniforms.lightViewProj * worldPos; 
    
    // Perspective division and map to [0,1] texture coords
    // p_clip_l.xyz / p_clip_l.w is in [-1, 1].
    // x, y: map [-1, 1] -> [0, 1]
    // z: map [-1, 1] -> [0, 1] (depth)
    let shadowCoords = vec3f(
        p_clip_l.x / p_clip_l.w * 0.5 + 0.5,
        -p_clip_l.y / p_clip_l.w * 0.5 + 0.5, // Flip Y for texture
        p_clip_l.z / p_clip_l.w
    );

    // 2. Read Depth from Shadow Map
    // Load exact pixel value. Map [0,1] to [0, 2048]
    let depth = textureLoad(shadowTexture, vec2u(shadowCoords.xy * vec2f(2048.0, 2048.0)), 0).r;

    // 3. Shadow Test
    // Add bias to prevent shadow acne
    let bias = 0.005;
    var visibility = 1.0;
    if (shadowCoords.z > depth + bias) {
        visibility = 0.4; // Shadow ambient factor
    }

    // 4. Final Color
    let texColor = textureSample(ourTexture, ourSampler, texCoords);
    return vec4f(texColor.rgb * visibility, 1.0);
}


// --------------------------------------------------------------------------
// TEAPOT
// --------------------------------------------------------------------------
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
}

@vertex
fn main_vs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> VSOut {
    var vsOut: VSOut;
    vsOut.position = uniforms.mvp * inPos;
    vsOut.inPos = inPos;
    vsOut.color = color;
    vsOut.normal = normal;
    return vsOut;
}

@fragment
fn main_fs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> @location(0) vec4f {
    let n = normalize(normal.xyz);

    // Calculate shadow for self-shadowing (Optional, but good for completeness)
    let p_clip_l = uniforms.lightViewProj * (uniforms.model * inPos);
    let shadowCoords = vec3f(
        p_clip_l.x / p_clip_l.w * 0.5 + 0.5,
        -p_clip_l.y / p_clip_l.w * 0.5 + 0.5,
        p_clip_l.z / p_clip_l.w
    );
    let depth = textureLoad(shadowTexture, vec2u(shadowCoords.xy * vec2f(2048.0, 2048.0)), 0).r;
    let bias = 0.005;
    var visibility = 1.0;
    if (shadowCoords.z > depth + bias) {
        visibility = 0.4;
    }

    // Lighting
    let k_d = vec3f(1) * uniforms.k_d;
    let k_a = k_d;
    let k_s = vec3f(1, 1, 1) * uniforms.k_s;

    let l_e = -normalize(uniforms.light_pos - (uniforms.model * inPos).xyz);
    let omega_i = -l_e;
    let L_e = vec3f(1, 1, 1) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1, 1, 1) * uniforms.L_a;

    let w_o = normalize(uniforms.eye - inPos.xyz);
    let w_r = 2 * dot(omega_i, n) * n - omega_i;

    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);
    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);
    let L_ra = k_a * L_a;

    let L_P_rs_select = select(vec3f(0, 0, 0), L_P_rs, dot(n, omega_i) > 0.0);

    let L_o = (L_rd + L_P_rs_select) * visibility + L_ra;

    return vec4f(L_o, 1.0);
}


// --------------------------------------------------------------------------
// SHADOW DEPTH PASS
// --------------------------------------------------------------------------
@vertex
fn main_vs_depth(@location(0) inPos: vec4f) -> @builtin(position) vec4f {
    // Transform model pos -> Light Clip Space
    return uniforms.lightViewProj * uniforms.model * inPos;
}

@fragment
fn main_fs_depth(@builtin(position) fragcoord: vec4f) -> @location(0) vec4f {
    // Write fragment depth (z) to texture
    return vec4f(fragcoord.z, 0.0, 0.0, 1.0);
}
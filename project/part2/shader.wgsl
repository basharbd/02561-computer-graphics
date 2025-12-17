// ---------------------------------------------------------
// SHADER: Ground (Textured + Transparent)
// ---------------------------------------------------------

struct GroundUniforms {
    mvp   : mat4x4f,
    alpha : vec4f, // .x = alpha value
};

@group(0) @binding(0) var<uniform> G : GroundUniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex  : texture_2d<f32>;

struct VSOutG {
    @builtin(position) pos_clip : vec4f,
    @location(0) uv : vec2f,
};

@vertex
fn vs_ground(@location(0) inPos : vec3f, @location(1) inUV : vec2f) -> VSOutG {
    var out : VSOutG;
    out.pos_clip = G.mvp * vec4f(inPos, 1.0);
    out.uv = inUV;
    return out;
}

@fragment
fn fs_ground(in: VSOutG) -> @location(0) vec4f {
    let color = textureSample(tex, samp, in.uv).rgb;
    // Return texture color with the uniform alpha
    return vec4f(color, G.alpha.x);
}

// ---------------------------------------------------------
// SHADER: Teapot (Phong Lighting)
// ---------------------------------------------------------

struct TeapotUniforms {
    mvp       : mat4x4f,
    model     : mat4x4f,
    normalMat : mat4x4f,
    eye       : vec4f,
    light     : vec4f, // .w = Le (Light Intensity)
    params    : vec4f, // x=La, y=kd, z=ks, w=shininess
};

@group(1) @binding(0) var<uniform> U : TeapotUniforms;

struct VSOutT {
    @builtin(position) pos_clip : vec4f,
    @location(0) pos_world : vec3f,
    @location(1) n_world   : vec3f,
};

@vertex
fn vs_teapot(@location(0) inPos : vec4f, @location(1) inNor : vec4f) -> VSOutT {
    var out : VSOutT;
    out.pos_clip = U.mvp * inPos;
    let worldPos = U.model * inPos;
    out.pos_world = worldPos.xyz;
    // Transform normal to world space
    out.n_world = normalize((U.normalMat * inNor).xyz);
    return out;
}

@fragment
fn fs_teapot(in: VSOutT) -> @location(0) vec4f {
    let baseColor = vec3f(0.9, 0.9, 0.9); // White teapot
    
    // Unpack params
    let La = U.params.x;
    let kd = U.params.y;
    let ks = U.params.z;
    let shininess = U.params.w;
    let Le = U.light.w;

    let N = normalize(in.n_world);
    let L = normalize(U.light.xyz - in.pos_world);
    let V = normalize(U.eye.xyz - in.pos_world);
    let H = normalize(L + V);

    // Lambertian
    let diff = max(dot(N, L), 0.0);
    // Specular (Blinn-Phong)
    let spec = pow(max(dot(N, H), 0.0), shininess);

    let ambient = La * baseColor;
    let diffuse = kd * diff * baseColor;
    let specular = ks * spec * vec3f(1.0, 1.0, 1.0);

    let finalColor = ambient + Le * (diffuse + specular);

    return vec4f(finalColor, 1.0);
}
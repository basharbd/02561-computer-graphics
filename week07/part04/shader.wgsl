struct Uniforms {
    mvp: mat4x4f,        // model-view-projection
    mtex: mat4x4f,       // texture-direction transform
    eye: vec3f,          // camera position (world)
    reflective: u32,     // 0: normal lookup, 1: reflection lookup
}

const pi = radians(180.0); // π constant (kept as-is)

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;         // cubemap sampler
@group(0) @binding(2) var cubeMap: texture_cube<f32>;  // environment cubemap
@group(0) @binding(3) var normalSampler: sampler;      // normal-map sampler
@group(0) @binding(4) var normalMap: texture_2d<f32>;  // normal-map texture

struct VSOut {
    @builtin(position) position: vec4f, // clip-space position
    @location(0) texCoord: vec4f,       // direction-like vector for shading
}

@vertex
fn main_vs(@location(0) inPos: vec4f, @builtin(instance_index) instance: u32) -> VSOut {
    var vsOut: VSOut;
    // clip-space transform
    vsOut.position = uniforms.mvp * inPos;
    // vector used for cubemap lookup / mapping
    vsOut.texCoord = uniforms.mtex * inPos;
    return vsOut;
}

// rotate a tangent-space vector v into the frame aligned with normal n
fn rotate_to_normal(n: vec3f, v: vec3f) -> vec3f {
    let sgn_nz = sign(n.z + 1.0e-16);
    let a = - 1.0 / (1.0 + abs(n.z));
    let b = n.x * n.y * a;
    return vec3f(1.0 + n.x * n.x * a, b, - sgn_nz * n.x) * v.x
         + vec3f(sgn_nz * b, sgn_nz * (1.0 + n.y * n.y * a), - n.y) * v.y
         + n * v.z;
}

@fragment
fn main_fs(@location(0) texCoord: vec4f) -> @location(0) vec4f {
    // spherical UV mapping from direction
    let u = 0.5 - atan2(texCoord.z, texCoord.x) / (2.0 * pi);
    let v = 0.5 + acos(texCoord.y) / pi;

    // sample normal map (tangent space), remap [0,1] -> [-1,1]
    var normal = textureSample(normalMap, normalSampler, vec2f(u, v)).xyz;
    normal = normal * 2.0 - 1.0;

    // rotate sampled normal into world-aligned frame around texCoord direction
    normal = normalize(rotate_to_normal(normalize(texCoord.xyz), normal.xyz));

    // base lookup direction
    let coord = normalize(texCoord.xyz);

    // reflection direction (with normal mapping)
    let incident = normalize(texCoord.xyz - uniforms.eye);
    let reflectDir = reflect(incident, normalize(normal));

    // choose plain env lookup or reflection lookup
    let coordFinal = select(coord, reflectDir, uniforms.reflective == 1u);

    // sample environment cubemap
    let texColor = textureSample(cubeMap, mySampler, coordFinal);
    return texColor;
}

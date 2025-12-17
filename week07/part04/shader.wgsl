struct Uniforms {
    mvp: mat4x4f,
    mtex: mat4x4f,
    eye: vec3f,
    reflective: u32,
}

const pi = radians(180.0);

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var cubeMap: texture_cube<f32>;
@group(0) @binding(3) var normalSampler: sampler;
@group(0) @binding(4) var normalMap: texture_2d<f32>;

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec4f,
}

@vertex
fn main_vs(@location(0) inPos: vec4f, @builtin(instance_index) instance: u32) -> VSOut {
    var vsOut: VSOut;
    vsOut.position = uniforms.mvp * inPos;
    vsOut.texCoord = uniforms.mtex * inPos;
    return vsOut;
}

fn rotate_to_normal(n: vec3f, v: vec3f) -> vec3f {
    let sgn_nz = sign(n.z + 1.0e-16);
    let a = - 1.0 / (1.0 + abs(n.z));
    let b = n.x * n.y * a;
    return vec3f(1.0 + n.x * n.x * a, b, - sgn_nz * n.x) * v.x + vec3f(sgn_nz * b, sgn_nz * (1.0 + n.y * n.y * a), - n.y) * v.y + n * v.z;
}

@fragment
fn main_fs(@location(0) texCoord: vec4f) -> @location(0) vec4f {
    // Circle uv mapping
    let u = 0.5 - atan2(texCoord.z, texCoord.x) / (2.0 * pi);
    let v = 0.5 + acos(texCoord.y) / pi;

    // Sample normal
    var normal = textureSample(normalMap, normalSampler, vec2f(u, v)).xyz;
    normal = normal * 2.0 - 1.0; // Transform from [0,1] to [-1,1]
    normal = normalize(rotate_to_normal(normalize(texCoord.xyz), normal.xyz));

    let coord = normalize(texCoord.xyz);
    let incident = normalize(texCoord.xyz - uniforms.eye);
    let reflectDir = reflect(incident, normalize(normal));

    let coordFinal = select(coord, reflectDir, uniforms.reflective == 1u);
    // let texColor = select(textureSample(cubeMap, mySampler, coordFinal), normal, uniforms.reflective == 1u); // Debug normal
    let texColor = textureSample(cubeMap, mySampler, coordFinal);
    return texColor;
}
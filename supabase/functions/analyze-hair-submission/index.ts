import { createJsonResponse, handleCorsPreflight } from '../_shared/cors.ts';
import { createStructuredResponse, resolveOpenRouterHairVisionModel } from '../_shared/ai-vision.ts';
import { verifyHairPhotoVerificationToken } from '../_shared/hair-photo-verification.ts';

const analysisSchema = {
  type: 'object',
  properties: {
    analysis: {
      type: 'object',
      properties: {
        is_hair_detected: {
          type: 'boolean',
        },
        invalid_image_reason: {
          type: 'string',
        },
        missing_views: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        per_view_notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              view: {
                type: 'string',
              },
              clearly_visible: {
                type: 'boolean',
              },
              notes: {
                type: 'string',
              },
            },
            required: ['view', 'clearly_visible', 'notes'],
          },
        },
        estimated_length: {
          type: 'number',
          nullable: true,
        },
        length_measurable: {
          type: 'boolean',
        },
        length_limit_reason: {
          type: 'string',
        },
        detected_color: {
          type: 'string',
        },
        detected_texture: {
          type: 'string',
        },
        detected_density: {
          type: 'string',
        },
        detected_condition: {
          type: 'string',
        },
        visible_damage_notes: {
          type: 'string',
        },
        confidence_score: {
          type: 'number',
          nullable: true,
        },
        shine_level: {
          type: 'integer',
        },
        frizz_level: {
          type: 'integer',
        },
        dryness_level: {
          type: 'integer',
        },
        oiliness_level: {
          type: 'integer',
        },
        damage_level: {
          type: 'integer',
        },
        bald_spots_present: {
          type: 'boolean',
        },
        affected_regions: {
          type: 'array',
          items: { type: 'string' },
        },
        hair_density_score: {
          type: 'number',
          nullable: true,
        },
        shedding_level: {
          type: 'string',
          enum: ['none', 'mild', 'moderate', 'severe'],
        },
        visible_scalp_area: {
          type: 'string',
        },
        scalp_coverage_notes: {
          type: 'string',
        },
        dandruff_detected: {
          type: 'boolean',
        },
        dandruff_severity: {
          type: 'string',
        },
        dandruff_notes: {
          type: 'string',
        },
        lice_detected: {
          type: 'boolean',
        },
        lice_confidence: {
          type: 'string',
        },
        lice_notes: {
          type: 'string',
        },
        improvement_tracking_status: {
          type: 'string',
        },
        improvement_recommendation: {
          type: 'string',
        },
        decision: {
          type: 'string',
        },
        summary: {
          type: 'string',
        },
        length_assessment: {
          type: 'string',
        },
        donation_readiness_note: {
          type: 'string',
        },
        history_assessment: {
          type: 'string',
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
              },
              recommendation_text: {
                type: 'string',
              },
              priority_order: {
                type: 'integer',
              },
            },
            required: ['title', 'recommendation_text', 'priority_order'],
          },
        },
      },
      required: [
        'is_hair_detected',
        'invalid_image_reason',
        'missing_views',
        'per_view_notes',
        'estimated_length',
        'length_measurable',
        'length_limit_reason',
        'detected_color',
        'detected_texture',
        'detected_density',
        'detected_condition',
        'visible_damage_notes',
        'confidence_score',
        'shine_level',
        'frizz_level',
        'dryness_level',
        'oiliness_level',
        'damage_level',
        'bald_spots_present',
        'affected_regions',
        'hair_density_score',
        'shedding_level',
        'visible_scalp_area',
        'scalp_coverage_notes',
        'dandruff_detected',
        'dandruff_severity',
        'dandruff_notes',
        'lice_detected',
        'lice_confidence',
        'lice_notes',
        'improvement_tracking_status',
        'improvement_recommendation',
        'decision',
        'summary',
        'length_assessment',
        'donation_readiness_note',
        'history_assessment',
        'recommendations',
      ],
    },
  },
  required: ['analysis'],
};

const lengthFallbackSchema = {
  type: 'object',
  properties: {
    analysis: {
      type: 'object',
      properties: {
        is_hair_detected: { type: 'boolean' },
        estimated_length: { type: 'number', nullable: true },
        length_measurable: { type: 'boolean' },
        length_limit_reason: { type: 'string' },
        length_assessment: { type: 'string' },
        detected_color: { type: 'string' },
        detected_texture: { type: 'string' },
        detected_density: { type: 'string' },
        detected_condition: { type: 'string' },
        confidence_score: { type: 'number', nullable: true },
        summary: { type: 'string' },
      },
      required: [
        'is_hair_detected',
        'estimated_length',
        'length_measurable',
        'length_limit_reason',
        'length_assessment',
        'detected_color',
        'detected_texture',
        'detected_density',
        'detected_condition',
        'confidence_score',
        'summary',
      ],
    },
  },
  required: ['analysis'],
};

const coreAnalysisSchema = {
  type: 'object',
  properties: {
    analysis: {
      type: 'object',
      properties: {
        is_hair_detected: { type: 'boolean' },
        invalid_image_reason: { type: 'string' },
        missing_views: {
          type: 'array',
          items: { type: 'string' },
        },
        per_view_notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              view: { type: 'string' },
              clearly_visible: { type: 'boolean' },
              notes: { type: 'string' },
            },
            required: ['view', 'clearly_visible', 'notes'],
          },
        },
        estimated_length: { type: 'number', nullable: true },
        length_assessment: { type: 'string' },
        detected_color: { type: 'string' },
        detected_texture: { type: 'string' },
        detected_density: { type: 'string' },
        detected_condition: { type: 'string' },
        visible_damage_notes: { type: 'string' },
        confidence_score: { type: 'number', nullable: true },
        shine_level: { type: 'integer', nullable: true },
        frizz_level: { type: 'integer', nullable: true },
        dryness_level: { type: 'integer', nullable: true },
        oiliness_level: { type: 'integer', nullable: true },
        damage_level: { type: 'integer', nullable: true },
        bald_spots_present: { type: 'boolean' },
        affected_regions: {
          type: 'array',
          items: { type: 'string' },
        },
        hair_density_score: { type: 'number', nullable: true },
        shedding_level: { type: 'string', enum: ['none', 'mild', 'moderate', 'severe'] },
        visible_scalp_area: { type: 'string' },
        scalp_coverage_notes: { type: 'string' },
        dandruff_detected: { type: 'boolean' },
        dandruff_severity: { type: 'string' },
        dandruff_notes: { type: 'string' },
        lice_detected: { type: 'boolean' },
        lice_confidence: { type: 'string' },
        lice_notes: { type: 'string' },
        improvement_tracking_status: { type: 'string' },
        improvement_recommendation: { type: 'string' },
        decision: { type: 'string' },
        summary: { type: 'string' },
        donation_readiness_note: { type: 'string' },
        history_assessment: { type: 'string' },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              recommendation_text: { type: 'string' },
              priority_order: { type: 'integer' },
            },
            required: ['title', 'recommendation_text', 'priority_order'],
          },
        },
      },
      required: [
        'is_hair_detected',
        'estimated_length',
        'length_assessment',
        'detected_condition',
        'confidence_score',
        'summary',
      ],
    },
  },
  required: ['analysis'],
};

type HairImage = {
  mimeType?: string;
  dataUrl?: string;
  viewKey?: string;
  viewLabel?: string;
};

type ComplianceContext = {
  acknowledged?: boolean;
  photo_verification_token?: string;
};

type DonationRequirementContext = {
  donation_requirement_id?: number | null;
  minimum_hair_length?: number | null;
  minimum_hair_length_inches?: number | null;
  chemical_treatment_status?: boolean | null;
  colored_hair_status?: boolean | null;
  bleached_hair_status?: boolean | null;
  rebonded_hair_status?: boolean | null;
  hair_texture_status?: string;
  notes?: string;
};

type SubmissionContext = {
  submission_id?: number | null;
  donation_drive_id?: number | null;
  organization_id?: number | null;
  detail_id?: number | null;
  declared_length?: number | null;
  declared_texture?: string;
  declared_density?: string;
  declared_condition?: string;
};

type HistoryContextEntry = {
  created_at?: string;
  detected_condition?: string;
  decision?: string;
  summary?: string;
  estimated_length?: number | null;
};

type HistoryContext = {
  total_checks?: number | null;
  latest_condition?: string;
  latest_check_at?: string;
  entries?: HistoryContextEntry[];
};

const requiredViewDefinitions = [
  {
    key: 'front_view',
    label: 'Front View Photo',
    role: 'main root or hairline and overall fall view',
    analysisFocus: 'Use this view to inspect the hairline or root area, face-forward framing, overall visible color, scalp visibility, density, and whether the full hair fall is visible from top to bottom. Reject this view if the donor is turned sideways instead of facing forward.',
  },
  {
    key: 'side_profile',
    label: 'Side Profile Photo',
    role: 'left side length and shaft structure view',
    analysisFocus: 'Use this view to inspect one clear side profile, visible donation length from the lower cheek/neck cut-start area to the ends, fullness through the shaft, texture consistency, and whether the lowest visible ends can be seen. Reject this view if it is another front-facing image.',
  },
  {
    key: 'right_side_profile',
    label: 'Right Side Photo',
    role: 'right side length and shaft structure view',
    analysisFocus: 'Use this view with the side profile view to cross-check visible donation length, shaft fullness, texture consistency, and condition from the opposite side. Do not require this view for older submissions if it is absent.',
  },
  {
    key: 'hair_scalp',
    label: 'Hair Scalp',
    role: 'scalp and crown coverage view',
    analysisFocus: 'Use this view to inspect visible scalp coverage, part line width, crown density, flakes, oiliness, buildup, redness-looking irritation, and overall root/scalp condition. Do not use this view as the primary basis for donation length.',
  },
  {
    key: 'hair_ends_close_up',
    label: 'Hair Ends Close-Up',
    role: 'close-up ends condition view',
    analysisFocus: 'Use this view to inspect split ends, frayed tips, dryness, frizz, breakage, and visible damage at the lowest ends. Do not use this view alone for total donation length.',
  },
  {
    key: 'back_hair',
    label: 'Back Hair Photo',
    role: 'back-side hair length and density view',
    analysisFocus: 'Use this view when available to cross-check back-side hair length, lowest visible ends, density, fullness, texture pattern, frizz, and damage. This view can improve donation length confidence, especially when front or side views do not show the lowest ends clearly.',
  },
] as const;
const minimumExpectedViews = ['Front View Photo', 'Side Profile Photo', 'Hair Scalp'];
const expectedViews = minimumExpectedViews;
const CM_PER_INCH = 2.54;
const MIN_ELIGIBILITY_CONFIDENCE = 0.75;
const ELIGIBLE_STATUS = 'Eligible for hair donation';
const NOT_ELIGIBLE_STATUS = 'Not eligible for donation yet';
const TRACKING_STATUS = 'Needs improvement tracking';
const IMPROVE_STATUS = NOT_ELIGIBLE_STATUS;
const CARE_SAFETY_NOTE = 'If you have allergies, scalp irritation, or sensitivity, consult a qualified hair or scalp care professional before trying new ingredients.';
const NON_ADVERTISING_CARE_OPTIONS: Record<string, string[]> = {
  dry: [
    'glycerin, aloe, or panthenol',
    'shea butter or coconut oil on the mid-lengths and ends',
  ],
  damage: [
    'hydrolyzed protein or amino acids used occasionally',
    'panthenol or ceramides focused on damaged ends',
  ],
  frizz: [
    'argan oil, coconut oil, or shea butter',
    'panthenol or glycerin for smoother-looking strands',
  ],
  oily: [
    'salicylic acid or tea tree oil used mainly on the scalp',
    'lightweight cleansing ingredients used on the scalp, not the ends',
  ],
  flakes: [
    'zinc pyrithione, selenium sulfide, or ketoconazole',
    'gentle scalp-cleansing ingredients for visible buildup or flakes',
  ],
  treated: [
    'amino acids, panthenol, or ceramides',
    'protein and moisturizing ingredients used in balance',
  ],
  healthy: [
    'panthenol, aloe, or lightweight plant oils',
    'small amounts of argan oil or coconut oil only on the ends',
  ],
};
const INGREDIENT_SUPPORTED_CONCERNS = new Set(['dry', 'damage', 'frizz', 'oily', 'flakes', 'treated']);
const advertisedNamePatterns = [
  /\bHuman Nature\b/gi,
  /\bDove\b/gi,
  /\bCream Silk\b/gi,
  /\bVitress\b/gi,
  /\bHead\s*&\s*Shoulders\b/gi,
  /\bSelsun Blue\b/gi,
  /\bPantene(?:\s+Pro-V)?\b/gi,
  /\bWatsons\b/gi,
  /\bSM\b/g,
  /\bRobinsons\b/gi,
  /\bLazada(?:\.ph)?\b/gi,
  /\bShopee(?:\.ph)?\b/gi,
];
const recommendationOriginPatterns = [
  /(?:neutral care|generic|local|country)?\s*product options? to consider:.*?(?:\.|$)/gi,
  /Ingredient or product-type options to consider:.*?(?:\.|$)/gi,
  /\bPhilippine(?:s)?\b/gi,
  /\b(?:country|locally|local)\s+(?:product|care)\s+options?\b/gi,
  /\b[A-Z][a-z]+(?:n|ian|ese|ish|i)\s+(?:product|brand|care)\s+options?\b/g,
];
const canonicalViewAliases: Record<string, string> = {
  'front view photo': 'Front View Photo',
  front_view: 'Front View Photo',
  'full hair length photo': 'Front View Photo',
  'side profile photo': 'Side Profile Photo',
  'side view photo': 'Side Profile Photo',
  'left side photo': 'Side Profile Photo',
  'right side photo': 'Right Side Photo',
  right_side_profile: 'Right Side Photo',
  side_profile: 'Side Profile Photo',
  side_view: 'Side Profile Photo',
  'hair ends close-up': 'Hair Ends Close-Up',
  'hair ends close up': 'Hair Ends Close-Up',
  'hair ends': 'Hair Ends Close-Up',
  hair_ends_close_up: 'Hair Ends Close-Up',
  'back hair photo': 'Back Hair Photo',
  'back view photo': 'Back Hair Photo',
  'back hair': 'Back Hair Photo',
  back_hair: 'Back Hair Photo',
  'hair scalp': 'Hair Scalp',
  'photo of the scalp': 'Hair Scalp',
  hair_scalp: 'Hair Scalp',
};

const formatLengthInches = (lengthCm: number) => `${(lengthCm / CM_PER_INCH).toFixed(1)} inches`;

const instructions = [
  // Role and output format
  'You are a hair-condition analyst reviewing donor hair photos for a hair donation mobile app.',
  'Your primary job is to carefully examine each uploaded photo, describe EXACTLY what you observe, then provide tailored recommendations based on those specific observations.',
  'Return valid JSON only — no markdown, no commentary outside the JSON structure.',

  // Image-first analysis mandate
  'CRITICAL RULE 1: The uploaded photos are the PRIMARY and MOST IMPORTANT source of truth. Questionnaire answers are ONLY supporting context.',
  'CRITICAL RULE 2: You MUST describe what you ACTUALLY SEE in the photos. Do not rely on questionnaire answers alone.',
  'CRITICAL RULE 3: Every recommendation MUST be based on VISIBLE observations from the photos, not generic hair care advice.',
  'CRITICAL RULE 4: Complete a two-pass review. First record evidence from every required view, then cross-check those observations before selecting the condition, numeric levels, summary, and recommendations.',
  'CRITICAL RULE 5: Do not invent a concern to fill a recommendation slot. When evidence is uncertain or the hair appears healthy, give conservative maintenance guidance and state the visibility limit through confidence_score or the summary.',
  '',
  'OBSERVATION CHECKLIST — examine each photo for:',
  '1. SCALP: Is the scalp visible? Is it oily (shiny, greasy appearance)? Dry (flaky, tight)? Clean? Any visible flaking, dandruff-like flakes, buildup, or visible lice/nits attached to hair shafts near the scalp?',
  '2. ROOTS: Are the roots oily or dry? Any product buildup visible?',
  '3. HAIR SHAFT: Does the hair look shiny and lustrous, or dull and matte? Any visible frizz along the shaft? Signs of chemical processing (uneven color, texture changes)?',
  '4. TEXTURE: Straight, wavy, curly, coily, or mixed? Is the texture consistent or uneven?',
  '5. DENSITY: How thick does the hair appear? Light, medium, thick, or dense coverage?',
  '6. ENDS: Are the ends split, frayed, or damaged? Do they look dry and rough, or healthy and sealed?',
  '7. OVERALL HEALTH: Does the hair look healthy and well-maintained, or does it show signs of damage, dryness, or neglect?',
  '8. SPECIFIC DAMAGE SIGNS: Breakage, thinning, brittleness, excessive frizz, uneven texture, color damage?',
  '9. SCALP COVERAGE: Note visible bald spots, patchy areas, thinning-looking regions, widened part line, or areas with more visible scalp. Treat this as wellness/progress tracking only, not a medical diagnosis.',
  '10. SCALP FINDINGS: Check the scalp/crown and root views for dandruff-like flakes and visible lice or nits. This is a visible screening only, not a diagnosis.',
  'MANDATORY SCALP INSPECTION PASS: Before returning the final JSON, re-check the Hair Scalp photo specifically along the part line, crown, roots, and visible hair shafts. Decide dandruff_detected, dandruff_severity, dandruff_notes, lice_detected, lice_confidence, and lice_notes from that close scalp review.',
  'The Hair Scalp per_view_notes entry must explicitly mention all three scalp finding categories: dandruff/flakes, lice, and nits. If none are visible, say none are visible. Do not omit these categories.',
  'DISTINGUISH SCALP FINDINGS CAREFULLY: dandruff/flakes are loose or scattered white/yellow particles on the scalp, roots, or part line and may look irregular. Nits are more uniform oval particles attached to individual hair shafts, often close to the scalp. Lice are visible insects. Do not label flakes or product buildup as lice/nits.',
  '',
  // Smart capture quality and environment detection
  'SMART CAPTURE QUALITY DETECTION — check BEFORE analysis:',
  '- DARK ENVIRONMENT: If a photo is underexposed, keep is_hair_detected=true and give a conservative hair-focused result. Mention lower confidence in summary, not as a retake/not-detected result.',
  '- SUBJECT CHECK: The photo set already passed validation. Keep is_hair_detected=true and focus on visible hair, scalp, length, texture, density, and condition.',
  '- MULTIPLE SUBJECTS: If background distractions exist, ignore unrelated background people and analyze the main submitted hair subject.',
  '- CROSS-VIEW SUBJECT CONSISTENCY: Compare visible hair color, texture, density, hairline/parting, clothing/shoulder area, and framing. Do not identify the person or infer sensitive identity traits. Since photo validation already passed, do not reject the set; return the closest hair-focused assessment.',
  '- MIXED HAIR SUBMISSION: Reject only when the scalp photo clearly belongs to different current hair than the front/side view, such as obviously different color, texture, density, or a stock/reference image. Do not reject merely because Hair Scalp is top-down, cropped, or does not show the full face.',
  '- OBSTRUCTIONS ON HAIR: If some hair is blocked, keep is_hair_detected=true and base the result on visible hair only. Mention lower confidence in the summary if needed.',
  '- DISTRACTING BACKGROUND: Ignore background distractions and analyze the main hair subject.',
  '- BLURRY OR MOTION-BLURRED: If detail is limited, keep is_hair_detected=true and return a conservative hair-focused assessment.',
  '',
  'Your detected_condition, visible_damage_notes, summary, and recommendations MUST directly reflect these observations.',
  'If the questionnaire says "dry hair" but the photos show shiny, healthy hair, trust the photos and note the discrepancy.',
  'If the photos show visible split ends and dryness but the questionnaire says "no problems", trust the photos.',

  // Hair detection and validity
  'First confirm whether the images clearly show human hair intended for screening.',
  'The photo set already passed pre-validation, so keep is_hair_detected=true unless the image payload is completely unrelated to hair.',
  'Validate photo rules before analysis: one human subject only, front view is face-forward, side profile is actually turned to the side, Hair Scalp clearly shows the scalp/crown or part line area, face and hair clearly visible where required, no masks or face coverings, no obstructing hair accessories, no caps, no clips covering the hair, no heavy blur, and no distracting objects blocking the hair. Ordinary eyeglasses are acceptable if they do not hide the hairline or hair.',
  'Validate cross-view consistency before hair analysis. The front and side views should appear to show the same current hair from the same person. The Hair Scalp view may crop the face or show a top-down head angle; compare it by hair/scalp cues only. Use only visible consistency cues; do not identify the person. Reject only if photos clearly appear to be from different people or clearly different current hair that cannot be explained by camera angle or lighting.',
  'Do not return not-detected, retake-required, or photo-validation style results. The output must be about visible hair analysis.',
  'If visibility is limited, keep is_hair_detected=true and lower confidence_score instead of rejecting the photo set.',
  `When image quality or visibility is too weak for a confident donation judgment, keep the final decision as "${NOT_ELIGIBLE_STATUS}" and explain the limitation honestly.`,

  // Per-view notes
  'For each provided photo view, write a detailed per_view_notes entry describing WHAT YOU SEE:',
  '- Front View: scalp condition, root oiliness/dryness, overall hair appearance, texture, density',
  '- Side Profile and Right Side Photo: confirm each side angle, then describe hair length visibility, shaft condition, shine or dullness, texture consistency',
  '- Hair Scalp: visible scalp coverage, part line/crown density, flakes or dandruff-like particles, oiliness, buildup, visible lice/nits if clearly seen, and root/scalp condition. This note must explicitly state whether dandruff/flakes, lice, and nits are visible or not visible.',
  '- Hair Ends Close-Up: visible split ends, fraying, dryness, roughness, frizz, or sealed healthy ends',
  '- Back Hair Photo: back-side length, lowest visible ends, fullness, texture pattern, and any visible dryness, frizz, or damage',
  'Use missing_views only when a required view is genuinely absent or completely unusable.',

  // Length estimation
  'Estimate DONATION LENGTH as a numeric estimated_length in centimeters for storage, but write all user-facing length wording in inches only.',
  'Set length_measurable=true only when a usable length view clearly shows the lower cheek/neck or nape cut-start area and the naturally hanging lowest ends.',
  'Set length_measurable=false, estimated_length=null, and explain length_limit_reason when hair is tied back, in a bun or ponytail, folded upward, held by a claw clip/hair clip/tie/scrunchie, or when the natural lowest ends are hidden, cropped, blocked, or covered. Never measure to the clip, bun, or tied section.',
  'Donation length starts at the likely cut-start area around the lower cheek, jawline, or neck ("bandang leeg"), not from the scalp, hairline, or root. Measure the visible hanging length from that cheek/neck start point down to the lowest clearly visible hair ends.',
  'Use the Front View Photo, Side Profile Photo, Right Side Photo, and Back Hair Photo together when available. The back-side photo is important for confirming the lowest visible ends and true hanging length. The hairline/root does not need to be visible for donation length if the cheek/neck or nape start area and lowest ends are visible.',
  'IMPORTANT LENGTH RULE: Do not return null just because there is no ruler. Make a conservative practical visual estimate using face/head scale and body landmarks. Approximate donation length from lower cheek/neck to ends: shoulder-length is usually about 4-8 inches, collarbone is usually about 6-10 inches, upper chest is usually about 8-12 inches, armpit is usually about 10-14 inches, mid-back is usually about 15-24 inches, waist is usually about 24-32 inches. Store the rounded numeric estimate in centimeters.',
  'Do NOT mark the donor eligible when the visible ends only reach the shoulder, collarbone, or upper chest. For eligibility, the visible lower cheek/neck-to-ends length must clearly exceed the current database minimum hair length requirement and usually needs to reach at least around armpit or longer in the side/front view.',
  'Return null for estimated_length whenever length_measurable=false. If loose, naturally hanging hair is clearly visible but simply too short for donation, still return the best conservative numeric estimate instead of null.',
  'In length_assessment, explicitly mention that the estimate starts around the lower cheek/neck/cut-start area and name the visible endpoint landmark, such as shoulder, collarbone, armpit, mid-back, waist, or "lowest visible ends". Use inches only in this text.',

  // Detected fields
  'detected_texture: use exactly one of Straight, Wavy, Curly, Coily, or Mixed based on visible hair pattern across all provided views. Consider shrinkage for curly and coily hair and do not penalize textured hair because visible stretched length may differ from hanging shape.',
  'detected_density: use Light, Medium, Thick, or Dense — based ONLY on what you see in the photos.',
  'bald_spots_present: true only when a clear no-hair or patchy low-coverage area is visible; false when not visible or uncertain.',
  'affected_regions: list visible coverage areas using only these simple labels when supported by the photos: front, crown, sides, back, hairline, part line, patches. Return [] if none are visible.',
  'hair_density_score: number from 0-100 estimating visible coverage fullness, where 0=no visible hair coverage in the checked area and 100=very full coverage. Use 50 when coverage cannot be assessed.',
  'shedding_level: use none, mild, moderate, or severe. Do not return "not sure"; choose the closest hair-focused value from the photos and questionnaire.',
  'visible_scalp_area: use none, low, moderate, or high. Do not return "unclear"; choose the closest visible scalp coverage level.',
  'scalp_coverage_notes: one concise, non-medical observation about visible scalp coverage, thinning-looking areas, bald spots, or why it cannot be assessed.',
  'dandruff_detected: true only when white/yellow flakes or dandruff-like particles are visibly present on scalp or roots; false when absent or uncertain.',
  'If the Hair Scalp view shows scattered white flake-like particles along the part line/crown/root area, set dandruff_detected=true even when the finding is mild. If unsure whether it is dandruff or product buildup, still mark dandruff_detected=true and explain "flake/buildup-like particles" in dandruff_notes.',
  'Dandruff-like particles are usually loose, scattered, irregularly shaped, and visible on the scalp surface or part line. They are not the same as lice or nits.',
  'dandruff_severity: use none, mild, moderate, or heavy based only on visible flakes plus questionnaire support. Use none when dandruff_detected is false.',
  'dandruff_notes: one concise observation about visible flakes/buildup, or "No visible dandruff-like flakes were observed."',
  'lice_detected: true only when lice or nits are clearly visible as small insects or attached oval particles on hair shafts near the scalp; false when absent or uncertain.',
  'Do not confuse loose white flakes, dandruff, or scalp/product buildup with lice/nits. Lice/nits require clear attached oval particles on individual shafts or visible insects.',
  'If the visible particles sit on the scalp/part line rather than being attached to hair shafts, classify them as dandruff/flakes or buildup, not lice/nits.',
  'Only set lice_detected=true when the evidence is stronger than dandruff evidence: attached oval nit-like particles on multiple hair shafts, or visible insect-like bodies. Otherwise keep lice_detected=false.',
  'If possible lice/nit-like particles are visible but not clear enough to confirm, keep lice_detected=false, set lice_confidence=low, and explain the uncertainty in lice_notes.',
  'lice_confidence: use none, low, medium, or high. Use high only when visible evidence is clear; use low when the image is unclear or only questionnaire context suggests concern.',
  'lice_notes: one concise visible-screening note. Do not diagnose infestation; say whether visible lice/nit-like signs were or were not observed.',
  'improvement_tracking_status: use one of: Ready for donation, Not eligible for donation yet, Needs improvement tracking.',
  'improvement_recommendation: one practical, non-medical wellness/progress tracking recommendation. If coverage concerns are visible, suggest tracking the same views over time and gentle scalp/hair care; do not name diseases or diagnoses.',
  'detected_condition: use one precise label based on the MOST PROMINENT VISIBLE condition you observe:',
  '  - Healthy: shiny, lustrous, no visible damage, sealed ends, good scalp condition',
  '  - Dry: dull appearance, rough texture, lack of shine, dry-looking ends',
  '  - Frizzy: visible frizz along shaft, flyaways, uneven texture',
  '  - Damaged: visible breakage, split ends, frayed ends, brittle appearance',
  '  - Oily: shiny/greasy scalp, oily roots, limp appearance near scalp',
  '  - Chemically Treated: uneven color, texture changes, processing signs',
  '  - Dry and Frizzy: combination of dullness and frizz',
  '  - Dry and Damaged: combination of dryness and visible damage',
  'Do NOT default to "Needs Better Photos" unless the image quality truly prevents observation.',
  'confidence_score: decimal 0–1 reflecting how clearly the photos allowed detailed observation.',

  // visible_damage_notes
  'visible_damage_notes: describe EXACTLY what you observe in the photos:',
  '- If you see split ends, say "visible split ends observed in close-up view"',
  '- If you see oily scalp, say "scalp appears oily with visible shine at roots"',
  '- If you see dryness, say "hair shaft appears dull with lack of natural shine"',
  '- If you see healthy hair, say "hair appears healthy with good shine and sealed ends"',
  'Be specific and factual. This field should read like observation notes, not generic statements.',

  // Summary
  'summary: write 2–3 sentences that:',
  '1. Start with what you OBSERVE in the photos (e.g., "The uploaded photos show hair with visible shine and healthy-looking ends...")',
  '2. Mention specific visible characteristics (texture, scalp condition, ends condition, shine/dullness)',
  '3. Connect observations to the detected condition',
  '4. End with "Final screening requires manual review."',

  // Recommendations
  'recommendations: provide exactly 3 recommendations that are DIRECTLY TIED to your observations.',
  '',
  'CRITICAL: Each recommendation MUST be SPECIFIC to what you OBSERVED in the photos.',
  'DO NOT give generic hair care advice. DO NOT repeat the same recommendations for different hair conditions.',
  '',
  'RECOMMENDATION GENERATION RULES:',
  '1. If you observed OILY SCALP → recommend scalp-control shampoo, washing technique, avoiding heavy products on scalp',
  '2. If you observed DRY HAIR/DULL APPEARANCE → recommend deep conditioning, moisturizing products, reducing wash frequency',
  '3. If you observed SPLIT/DAMAGED ENDS → recommend trimming ends, protein treatments, reducing heat',
  '4. If you observed FRIZZ → recommend anti-frizz products, microfiber towel, humidity protection',
  '5. If you observed HEALTHY HAIR → recommend maintenance routine, protective measures, monthly treatments',
  '6. If you observed CHEMICAL DAMAGE → recommend color-safe products, protein-moisture balance, recovery treatments',
  '7. If you observed SCALP FLAKING → recommend gentle scalp cleansing and neutral anti-dandruff ingredients where appropriate',
  '8. If visible lice or nit-like signs are clearly observed → recommend pausing donation and consulting a qualified health or scalp care professional before donation; do not suggest home diagnosis.',
  '',
  'Each recommendation must have:',
  '- title: short, specific label (e.g., "Address Visible Split Ends" not "Hair Care")',
  '- recommendation_text: 2–3 actionable sentences explaining WHAT to do and WHY based on what you observed',
  '- priority_order: 1 = most urgent based on severity of observed issue',

  // Decision
  `decision: set to exactly one of: "${ELIGIBLE_STATUS}" or "${NOT_ELIGIBLE_STATUS}".`,
  'Base this on: (1) visible evidence from photos, (2) donation requirement context if provided, (3) observed hair condition.',
  `Use "${NOT_ELIGIBLE_STATUS}" when image quality prevents a confident visible-length or condition judgment.`,

  // donation_readiness_note
  `donation_readiness_note: When the estimated_length clearly exceeds the current database minimum hair length requirement from the lower cheek/neck cut-start area to the ends, the endpoint landmark is armpit/mid-back/waist or similarly long, confidence_score is at least ${MIN_ELIGIBILITY_CONFIDENCE}, AND the detected_condition is Healthy or otherwise suitable, write 1-2 specific, encouraging sentences about what the donor should do to prepare for donation. When the hair is not yet ready for donation, return an empty string.`,

  // history_assessment
  'history_assessment: if 2 or more prior hair-check entries are provided, compare current vs prior. Otherwise return empty string.',

  // Safety
  'Use safe wording: "this check suggests", "based on the visible photos", "the photos show", "observed in the images".',
  'Do not diagnose medical conditions, causes of hair loss, alopecia types, infections, or hormonal issues. Use "visible scalp area", "patchy coverage", "low density", or "shedding reported" instead.',
  'Do not mention brand names, company names, store names, shopping links, advertised product names, countries, country-based product origins, or country-specific product options in recommendations.',
  'Mention neutral ingredients only when they clearly match a visible concern. Do not include ingredients for length-only, healthy-maintenance, retake-photo, or recheck-only recommendations.',
  'Ingredient examples by concern: dryness can mention glycerin, aloe, panthenol, shea butter, or coconut oil; visible damage can mention hydrolyzed protein, amino acids, panthenol, or ceramides; frizz can mention argan oil, coconut oil, shea butter, panthenol, or glycerin; visible flakes can mention zinc pyrithione, selenium sulfide, or ketoconazole; oily roots can mention salicylic acid or tea tree oil; chemically treated hair can mention amino acids, panthenol, ceramides, or balanced protein and moisturizing ingredients.',
  'If ingredients are mentioned, include a short caution that users with allergies, scalp irritation, or sensitivity should consult a qualified hair or scalp care professional before trying new ingredients.',
  'If a field cannot be determined from the photos, return an empty string or null.',
  'This is AI-assisted screening guidance only, not medical advice.',
].join('\n');

const analysisInstructions = [
  instructions,
  'You are an AI hair analysis assistant.',
  'Return valid JSON only.',
  'Return one JSON object only.',
  'Do not use markdown.',
  'Do not wrap the JSON in code fences.',
  'Do not add explanatory text before or after the JSON.',
  'Use only the current uploaded or captured hair photos as the main basis for the result. Use the questionnaire only as supporting context, not the main basis.',
  'Never reuse or copy prior saved results, prior recommendations, or generic template wording as the current result.',
  'History context, when present, is only for trend comparison and must never replace the current image observations.',
  'Treat each required image role separately and use the correct evidence from that view before deciding the final result.',
  'Use a two-pass assessment: inspect and record each required view independently, then reconcile the six view notes into one internally consistent result before generating care guidance.',
  'Use Front View Photo, Side Profile Photo, Right Side Photo, and Back Hair Photo together for donation length assessment from the lower cheek/neck or nape cut-start area to the lowest visible ends. Back Hair Photo should strengthen or correct the length estimate when it shows the lowest ends more clearly than front or side views. Hair Scalp is the main basis for visible scalp coverage, crown/part line density, flakes, oiliness, buildup, and root condition. Hair Ends Close-Up is the main basis for split ends and end damage.',
  'Before estimating length or generating recommendations, compare the required views using visible hair consistency only. Do not identify the person. Since photo validation already passed, do not reject the submission; return the closest conservative hair assessment.',
  'For every provided required view, return one per_view_notes entry using the exact canonical label: Front View Photo, Side Profile Photo, Right Side Photo, Hair Scalp, Hair Ends Close-Up, or Back Hair Photo.',
  'Each per_view_notes entry must describe actual visible evidence from that specific image, not generic statements.',
  'Analyze visible hair condition, visible hair assessment, visible hair color, visible hair length estimate, donation suitability, and improvement recommendations.',
  'Be practical, honest, and evidence-based. Do not invent certainty when the image evidence is weak.',
  'Analyze visible clues such as dryness, oiliness, dandruff-like flakes if visible, visible lice or nit-like signs if clearly visible, frizz, roughness, split or damaged ends, shine or dullness, density appearance, texture appearance, scalp visibility, visible color, and overall healthy or unhealthy appearance.',
  'Also analyze visible scalp coverage, dandruff-like flakes, lice/nit-like signs, and user-reported hair fall for wellness/progress tracking: bald_spots_present, affected_regions, hair_density_score, shedding_level, visible_scalp_area, scalp_coverage_notes, dandruff_detected, dandruff_severity, dandruff_notes, lice_detected, lice_confidence, lice_notes, improvement_tracking_status, and improvement_recommendation.',
  'Do not give generic repeated recommendations unless the visible evidence truly supports them.',
  'Do not let the final result mainly focus on retaking photos, improving lighting, or capture quality. Mention those only briefly when they materially limit confidence.',
  'Use per_view_notes for factual view-specific observations that describe what is actually visible.',
  'Use visible_damage_notes for a concise note about visible damage, or state that no obvious visible damage is seen when appropriate.',
  'detected_color: REQUIRED — always return a non-empty value. Inspect the photos and return the dominant visible hair color from: Black, Dark Brown, Brown, Light Brown, Blonde, Auburn, Red, Dyed, or Multiple Tones. Never return "Unclear" or an empty string because the photo set already passed validation.',
  'Use detected_condition for the main visible condition. Prefer labels like Healthy, Dry, Oily, Damaged, Mixed Concerns, Frizzy, Dry and Damaged, Dry and Frizzy, or Chemically Treated.',
  'Estimate visible donation length only. Donation length means the visible hanging length from the lower cheek/jawline/neck cut-start area to the lowest clearly visible hair end, not scalp-to-end or root-to-end length.',
  'Use the front, side, right-side, and back hair views together to assess visible cheek/neck or nape-to-ends donation length when those views are available.',
  'Use length_assessment to explain how the visible donation length was judged from the current images and to state any visibility limits honestly. Mention the lower cheek/neck start area, visible ends, and the body landmark used for approximation. Use inches only in this text.',
  'When loose hair, the lower cheek/neck cut-start area, and the naturally hanging ends are visible but no ruler is present, return a conservative approximate estimated_length in centimeters using visible face/head/body proportions. Round to the nearest whole centimeter.',
  'If the hair appears short, shoulder-length, or below the donation threshold, return the approximate short length in centimeters instead of null.',
  'Do not invent fake precision. Curled hair may receive a conservative estimate only when its naturally hanging ends remain visible. Tied, clipped, folded, blocked, covered, or cropped hair is not measurable and must return estimated_length=null.',
  'Donation suitability must respect the current database minimum hair length requirement measured from the lower cheek/neck cut-start area to the lowest visible ends.',
  `Set decision to exactly one of: "${ELIGIBLE_STATUS}" or "${NOT_ELIGIBLE_STATUS}".`,
  `Use "${ELIGIBLE_STATUS}" only when the visible donation length clearly exceeds the current database minimum hair length requirement, the visible endpoint is around armpit or longer, the visible condition appears suitable for donation, and confidence_score is at least ${MIN_ELIGIBILITY_CONFIDENCE}.`,
  `Use "${NOT_ELIGIBLE_STATUS}" when the visible donation length appears below the current database minimum hair length requirement, the visible condition is not suitable, or the evidence is too limited for confident eligibility.`,
  `Use "${NOT_ELIGIBLE_STATUS}" when clear bald spots, high visible scalp area, or severe shedding concerns mean the user is not ready to donate yet. Set improvement_tracking_status to "${TRACKING_STATUS}" when the user should track visible coverage or shedding progress.`,
  `If the hair looks healthy but too short for donation, still return "${NOT_ELIGIBLE_STATUS}" and tailor recommendations toward healthy growth, length retention, reduced breakage, and maintaining current hair health.`,
  'Questionnaire answers are required supporting context for wash frequency, itch, flakes, oiliness, dryness/roughness, hair fall, chemical history, heat use, and self-reported hair type. They must shape summary and recommendations without replacing photo evidence.',
  'confidence_score must reflect image clarity, visibility of ends and full length, texture and scalp detail, consistency across views, and consistency with the questionnaire.',
  'Return shine_level, frizz_level, dryness_level, oiliness_level, and damage_level as integers from 1 to 10. These MUST reflect your actual photo observations and MUST be logically consistent with your summary, visible_damage_notes, and detected_condition.',
  'SHINE (positive metric): 1=hair is completely dull and matte, 4-5=moderate shine, 7-9=clearly shiny and lustrous, 10=extremely glossy. If you describe the hair as shiny, healthy, or lustrous anywhere in your response, shine_level MUST be ≥ 6. Do NOT return 1 for shiny-looking hair.',
  'FRIZZ (concern): 1=absolutely no frizz visible at all, 4-5=moderate frizz, 8-10=severe frizz. Use 1 ONLY when zero frizz is visible in any view.',
  'DRYNESS (concern): 1=hair appears well-moisturized with no dryness, 4-5=moderate dryness, 8-10=severely dry and brittle. Use 1 ONLY when hair shows no dryness signs.',
  'OILINESS (concern): 1=scalp and hair are clean and balanced with no oiliness, 4-5=moderate oiliness, 8-10=very greasy. Use 1 ONLY when no oiliness is observed.',
  'DAMAGE (concern): 1=no visible damage, split ends, or breakage whatsoever, 4-5=moderate damage, 8-10=severe damage throughout. Use 1 ONLY when ZERO damage signs exist.',
  'CRITICAL CONSISTENCY RULE: Your numeric levels MUST match your written observations. If your summary says "shiny", shine_level ≥ 6. If your visible_damage_notes say "no visible damage", damage_level ≤ 2. Returning 1 for shine on healthy shiny hair is an error. Returning 1 for all levels on any observed hair is almost always wrong — calibrate each level independently based on what you see.',
  'summary must be concise, human-friendly, and combine image-based observations, questionnaire context, and the final combined assessment.',
  'history_assessment should mention whether the current result appears better, similar, or worse than recent saved checks only when history is provided, while staying grounded in the current images.',
  'recommendations must focus on improving hair condition, maintaining healthy hair, supporting longer healthier growth if the hair is too short, and reducing visible damage.',
  'Return exactly 3 recommendations when hair is visible enough to analyze.',
  'Recommendations should be specific to the observed condition, such as reducing heat exposure, improving scalp care, adjusting wash routine, improving moisture care, trimming damaged ends when appropriate, and avoiding harsh chemical processing.',
  'Each recommendation must address an observation supported by the current per_view_notes or a questionnaire answer that is consistent with those images. Never invent damage, dryness, flakes, lice, thinning, oiliness, or chemical treatment merely to produce three different steps.',
  'If the visible hair is too short for donation, include guidance about length retention, healthy growth habits, or reducing breakage. If the hair is dry, recommendations must address dryness. If the hair appears healthy, recommendations must focus on maintenance rather than damage repair.',
  'Do not use recommendation slots for camera, upload, lighting, retake, photo framing, or recheck instructions. Those belong before analysis, not in hair-care recommendations.',
  'Do not recommend or advertise products. Do not name brands, companies, stores, marketplaces, shopping links, product lines, countries, country-made products, or country-specific options. Mention only neutral ingredients that clearly match the observed concern, and skip ingredients when the recommendation is only about length, maintenance, retaking photos, or rechecking.',
  'If ingredients are mentioned, include a short caution that users with allergies, scalp irritation, or sensitivity should consult a qualified hair or scalp care professional before trying new ingredients.',
  `For donation eligibility, require confidence_score >= ${MIN_ELIGIBILITY_CONFIDENCE}. If confidence is lower, use "${NOT_ELIGIBLE_STATUS}" and explain what must be clearer.`,
  'Be conservative with eligibility: if cheek/neck-to-ends donation length, ends condition, chemical treatment status, or required views are uncertain, do not mark the donor eligible.',
  'Do not diagnose disease. Use careful phrases such as "the photos show", "this check suggests", and "based on the visible images".',
].join('\n');


const normalizeString = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
);

const normalizeSheddingLevel = (value: unknown, fallback: 'none' | 'mild' = 'mild') => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;

  if (/^(none|no|absent|normal)$/.test(normalized) || /\b(no|without)\s+(visible\s+)?(hair\s+)?(fall|loss|shedding)\b/.test(normalized)) {
    return 'none';
  }
  if (/^(mild|low|minimal|slight|light)$/.test(normalized) || /\b(mild|low|minimal|slight|light)\b/.test(normalized)) {
    return 'mild';
  }
  if (/^(moderate|medium|average)$/.test(normalized) || /\b(moderate|medium|average)\b/.test(normalized)) {
    return 'moderate';
  }
  if (/^(severe|high|heavy|excessive|significant)$/.test(normalized) || /\b(severe|high|heavy|excessive|significant)\b/.test(normalized)) {
    return 'severe';
  }

  return fallback;
};

const hasVisibleDandruffEvidence = (value = '') => {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return false;
  if (/\b(no|not|without)\s+(?:visible\s+)?(?:dandruff|flakes?|flaking|white particles?|yellow particles?|buildup)\b/i.test(normalized)) {
    return false;
  }
  return /\b(dandruff|flakes?|flaking|white particles?|yellow particles?|flake-like|dandruff-like|scaly|buildup)\b/i.test(normalized);
};

const removeAdvertisedNames = (value: string) => {
  let cleaned = normalizeString(value);
  advertisedNamePatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, 'generic');
  });
  recommendationOriginPatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '');
  });
  return cleaned
    .replace(/\bgeneric\s+generic\b/gi, 'generic')
    .replace(/\bneutral care\s+neutral care\b/gi, 'neutral care')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const normalizeViewLabel = (value: unknown) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('back hair') || normalized.includes('back view') || normalized === 'back' || normalized.includes('back')) {
    return 'Back Hair Photo';
  }
  if (normalized.includes('hair ends') || normalized.includes('ends close')) {
    return 'Hair Ends Close-Up';
  }
  if (normalized.includes('hair scalp') || normalized.includes('scalp') || normalized.includes('crown')) {
    return 'Hair Scalp';
  }
  if (normalized.includes('front view') || normalized === 'front' || normalized.includes('front')) {
    return 'Front View Photo';
  }
  if (normalized.includes('right side') || normalized.includes('right_side')) {
    return 'Right Side Photo';
  }
  if (normalized.includes('side profile') || normalized.includes('side view') || normalized.includes('left side') || normalized.includes('right side') || normalized.includes('side')) {
    return 'Side Profile Photo';
  }
  return canonicalViewAliases[normalized] || normalizeString(value);
};

const getImageCanonicalViewLabels = (image: Partial<HairImage> = {}) => {
  const labels = [
    normalizeViewLabel(image.viewLabel),
    normalizeViewLabel(image.viewKey),
  ].filter(Boolean);

  return [...new Set(labels)];
};

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const nearlyEqualLength = (left: number, right: number) => (
  Math.abs(left - right) <= Math.max(0.2, Math.abs(right) * 0.02)
);

const extractExplicitLengthMeasurements = (value: string) => {
  const measurements: Array<{ value: number; unit: 'in' | 'cm' }> = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(inches?|in\.?|centimet(?:er|re)s?|cm)\b/gi;
  let match = pattern.exec(normalizeString(value));

  while (match) {
    const measurement = normalizeNumber(match[1]);
    if (measurement != null && measurement > 0) {
      measurements.push({
        value: measurement,
        unit: String(match[2] || '').toLowerCase().startsWith('in') ? 'in' : 'cm',
      });
    }
    match = pattern.exec(normalizeString(value));
  }

  return measurements;
};

const normalizeEstimatedLengthCm = (rawValue: unknown, evidenceText: string) => {
  const rawLength = normalizeNumber(rawValue);
  const measurements = extractExplicitLengthMeasurements(evidenceText);

  if (rawLength != null && rawLength > 0) {
    for (const measurement of measurements) {
      const describedLengthCm = measurement.unit === 'in'
        ? measurement.value * CM_PER_INCH
        : measurement.value;
      if (nearlyEqualLength(rawLength, describedLengthCm)) return Math.round(rawLength * 10) / 10;
      if (measurement.unit === 'in' && nearlyEqualLength(rawLength, measurement.value)) {
        return Math.round(describedLengthCm * 10) / 10;
      }
    }
    return Math.round(rawLength * 10) / 10;
  }

  const firstMeasurement = measurements[0];
  if (!firstMeasurement) return null;
  const inferredCm = firstMeasurement.unit === 'in'
    ? firstMeasurement.value * CM_PER_INCH
    : firstMeasurement.value;
  return Math.round(inferredCm * 10) / 10;
};

const normalizeConfidence = (value: unknown) => {
  const parsed = normalizeNumber(value);
  if (parsed === null) return null;
  if (parsed > 1 && parsed <= 100) return Math.max(0, Math.min(1, parsed / 100));
  return Math.max(0, Math.min(1, parsed));
};

const normalizeHairTexture = (value: unknown, questionnaireAnswers: Record<string, unknown> = {}) => {
  const source = normalizeString(value) || normalizeString(questionnaireAnswers?.hair_texture);
  const normalized = source.toLowerCase();
  if (normalized.includes('straight')) return 'Straight';
  if (normalized.includes('wavy') || normalized.includes('wave')) return 'Wavy';
  if (normalized.includes('curly') || normalized.includes('curl')) return 'Curly';
  if (normalized.includes('coily') || normalized.includes('coil') || normalized.includes('kinky')) return 'Coily';
  if (normalized.includes('mixed') || normalized.includes('combination')) return 'Mixed';
  return '';
};

const normalizeLevel10 = (value: unknown, fallback = 1) => {
  const parsed = normalizeNumber(value);
  if (parsed === null) return fallback;
  return Math.max(1, Math.min(10, Math.round(parsed)));
};

const inferApproximateLengthFromText = (value: string) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return null;

  const explicitMeasurement = extractExplicitLengthMeasurements(normalized)[0];
  if (explicitMeasurement) {
    return explicitMeasurement.unit === 'in'
      ? Math.round(explicitMeasurement.value * CM_PER_INCH * 10) / 10
      : explicitMeasurement.value;
  }

  const rules: { keywords: string[]; lengthCm: number }[] = [
    { keywords: ['waist-length', 'waist length', 'reaches the waist', 'at the waist'], lengthCm: 82 },
    { keywords: ['lower back', 'low back'], lengthCm: 72 },
    { keywords: ['mid-back', 'mid back', 'middle of the back'], lengthCm: 62 },
    { keywords: ['armpit-length', 'armpit length', 'underarm'], lengthCm: 38 },
    { keywords: ['upper chest', 'chest length', 'reaches the chest', 'around the chest'], lengthCm: 32 },
    { keywords: ['collarbone-length', 'collarbone length', 'collarbone', 'near the clavicle', 'clavicle'], lengthCm: 35 },
    { keywords: ['shoulder-length', 'shoulder length', 'at the shoulders', 'near the shoulders', 'reaches the shoulders'], lengthCm: 30 },
    { keywords: ['neck-length', 'neck length', 'nape length', 'reaches the neck'], lengthCm: 24 },
    { keywords: ['chin-length', 'chin length', 'around the chin'], lengthCm: 18 },
    { keywords: ['ear-length', 'ear length', 'around the ears'], lengthCm: 12 },
  ];

  const matched = rules.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  return matched?.lengthCm ?? null;
};

const normalizeMissingViews = (source: unknown) => {
  const list = Array.isArray(source)
    ? source.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  const seen = new Set<string>();

  return list.filter((item) => {
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const normalizePerViewNotes = (source: unknown) => {
  const rows = Array.isArray(source)
    ? source
      .map((item) => ({
        view: normalizeViewLabel(item?.view),
        clearly_visible: item?.clearly_visible !== false,
        notes: normalizeString(item?.notes),
      }))
      .filter((item) => item.view)
    : [];
  const deduped = new Map<string, { view: string; clearly_visible: boolean; notes: string }>();

  rows.forEach((item) => {
    const existing = deduped.get(item.view);
    if (!existing || item.notes.length > existing.notes.length) {
      deduped.set(item.view, item);
    }
  });

  return Array.from(deduped.values());
};

const normalizeRecommendationsV2 = (source: unknown) => {
  const rows = Array.isArray(source)
    ? source
      .map((item, index) => ({
        title: removeAdvertisedNames(normalizeString(item?.title) || `Recommendation ${index + 1}`),
        recommendation_text: removeAdvertisedNames(normalizeString(item?.recommendation_text)),
        priority_order: Number.isFinite(Number(item?.priority_order)) && Number(item?.priority_order) > 0
          ? Number(item?.priority_order)
          : index + 1,
      }))
      .filter((item) => item.recommendation_text)
      .sort((left, right) => left.priority_order - right.priority_order)
    : [];

  return rows.slice(0, 3);
};

const buildRequiredViewRoleText = () => (
  requiredViewDefinitions
    .map((view) => `- ${view.label} (${view.key}): ${view.analysisFocus}`)
    .join('\n')
);

const formatProvidedImageRoles = (images: HairImage[] = []) => (
  images
    .map((image, index) => {
      const canonicalLabel = normalizeViewLabel(image.viewLabel || image.viewKey);
      const matchingView = requiredViewDefinitions.find((view) => view.label === canonicalLabel);
      return `${index + 1}. ${canonicalLabel || image.viewLabel || image.viewKey || `Photo ${index + 1}`} -> ${matchingView?.role || 'additional photo view'}`;
    })
    .join('\n')
);

const hasMeaningfulViewEvidence = ({
  isHairDetected,
  providedViews,
  perViewNotes,
}: {
  isHairDetected: boolean;
  providedViews: string[];
  perViewNotes: { view: string; clearly_visible: boolean; notes: string }[];
}) => {
  if (!isHairDetected) return true;

  const evidenceViews = new Set(
    perViewNotes
      .filter((item) => item.notes.length >= 12)
      .map((item) => normalizeViewLabel(item.view))
      .filter(Boolean),
  );

  return providedViews.every((view) => evidenceViews.has(view));
};

const hasRootToEndLengthRationale = (value: string) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return false;

  const mentionsRootArea = normalized.includes('root') || normalized.includes('hairline');
  const mentionsEnds = normalized.includes('end');
  return mentionsRootArea && mentionsEnds;
};

const hasShortEndpointLandmark = (value: string) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return false;

  const hasLongEndpoint = includesAnyKeyword(normalized, [
    'armpit',
    'underarm',
    'mid-back',
    'mid back',
    'middle of the back',
    'lower back',
    'low back',
    'waist',
  ]);
  if (hasLongEndpoint) return false;

  return includesAnyKeyword(normalized, [
    'shoulder',
    'shoulder-length',
    'collarbone',
    'clavicle',
    'upper chest',
    'chest length',
    'reaches the chest',
    'around the chest',
    'neck-length',
    'nape length',
    'chin-length',
    'jaw-length',
  ]);
};

const hasUnmeasurableLengthEvidence = (value: string) => {
  const normalized = normalizeString(value).replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return false;

  return [
    /\b(?:hair\s+(?:is|appears|looks)\s+)?(?:tied|pulled)\s+back\b/,
    /\b(?:ponytail|bun|updo)\b/,
    /\b(?:secured|held|fastened)\s+(?:back\s+)?with\s+(?:a\s+)?(?:claw\s+)?clip\b/,
    /\b(?:claw clip|hair clip|scrunchie|hair tie)\s+(?:is\s+)?(?:holding|securing|blocking|covering|obstructing)\b/,
    /\b(?:lowest\s+)?(?:hair\s+)?ends?\s+(?:are|is|remain|were)?\s*(?:not visible|hidden|blocked|covered|cropped|obstructed)\b/,
    /\b(?:cannot|can't|unable to|could not)\s+(?:clearly\s+)?(?:see|identify|confirm|measure)\s+(?:the\s+)?(?:lowest\s+)?(?:hair\s+)?ends?\b/,
    /\b(?:length|donation length)\s+(?:cannot|can't|could not|is not able to be)\s+(?:be\s+)?(?:measured|estimated|confirmed)\b/,
  ].some((pattern) => pattern.test(normalized));
};

const hasCrossViewConsistencyIssue = (value: string) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return false;

  return includesAnyKeyword(normalized, [
    'different people',
    'different person',
    'different subject',
    'inconsistent across views',
    'views are inconsistent',
    'photos appear inconsistent',
    'hair views are inconsistent',
    'mixed hair length',
    'mixed long',
    'unrelated hair',
    'does not match',
    'mismatched hair',
    'mismatch',
  ]);
};

const buildRecommendationKeywordChecks = ({
  detectedCondition,
  visibleDamageNotes,
  estimatedLength,
  minimumDonationLengthCm,
}: {
  detectedCondition: string;
  visibleDamageNotes: string;
  estimatedLength: number | null;
  minimumDonationLengthCm: number;
}) => {
  const normalizedCondition = detectedCondition.toLowerCase();
  const normalizedDamageNotes = visibleDamageNotes.toLowerCase();
  const checks: string[][] = [];

  if (estimatedLength != null && estimatedLength < minimumDonationLengthCm) {
    checks.push(['length', 'growth', 'retain', 'retention', 'breakage', 'longer', 'grow']);
  }

  if (normalizedCondition.includes('dry')) {
    checks.push(['dry', 'moist', 'hydr', 'condition']);
  }

  if (normalizedCondition.includes('frizz')) {
    checks.push(['frizz', 'smooth', 'humidity', 'serum']);
  }

  if (
    normalizedCondition.includes('damage')
    || normalizedDamageNotes.includes('split')
    || normalizedDamageNotes.includes('fray')
    || normalizedDamageNotes.includes('breakage')
  ) {
    checks.push(['trim', 'split', 'damage', 'repair', 'protein', 'heat', 'breakage']);
  }

  if (normalizedCondition.includes('oily')) {
    checks.push(['oil', 'oily', 'scalp', 'shampoo', 'wash', 'buildup']);
  }

  if (normalizedCondition.includes('healthy') && !(estimatedLength != null && estimatedLength < minimumDonationLengthCm)) {
    checks.push(['maintain', 'maintenance', 'protect', 'preserve', 'continue']);
  }

  if (normalizedCondition.includes('treated')) {
    checks.push(['chemical', 'color-safe', 'protein', 'moisture', 'recover']);
  }

  return checks;
};

const recommendationsAlignWithFindings = ({
  recommendations,
  detectedCondition,
  visibleDamageNotes,
  estimatedLength,
  minimumDonationLengthCm,
}: {
  recommendations: { title: string; recommendation_text: string; priority_order: number }[];
  detectedCondition: string;
  visibleDamageNotes: string;
  estimatedLength: number | null;
  minimumDonationLengthCm: number;
}) => {
  if (!recommendations.length) return false;

  const combinedText = recommendations
    .map((item) => `${item.title} ${item.recommendation_text}`.toLowerCase())
    .join(' ');

  const keywordChecks = buildRecommendationKeywordChecks({
    detectedCondition,
    visibleDamageNotes,
    estimatedLength,
    minimumDonationLengthCm,
  });

  return keywordChecks.every((keywords) => keywords.some((keyword) => combinedText.includes(keyword)));
};

const includesAnyKeyword = (value: string, keywords: string[]) => {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
};

const inferRecommendationConcerns = ({
  detectedCondition,
  visibleDamageNotes,
  summary,
  estimatedLength,
  minimumDonationLengthCm,
}: {
  detectedCondition: string;
  visibleDamageNotes: string;
  summary: string;
  estimatedLength: number | null;
  minimumDonationLengthCm: number;
}) => {
  const combined = `${detectedCondition} ${visibleDamageNotes} ${summary}`.toLowerCase();
  const concerns: string[] = [];

  if (estimatedLength == null || estimatedLength < minimumDonationLengthCm) concerns.push('length');
  if (includesAnyKeyword(combined, ['dry', 'dull', 'brittle', 'rough'])) concerns.push('dry');
  if (includesAnyKeyword(combined, ['split', 'fray', 'breakage', 'damage', 'damaged'])) concerns.push('damage');
  if (includesAnyKeyword(combined, ['frizz', 'flyaway', 'uneven texture'])) concerns.push('frizz');
  if (includesAnyKeyword(combined, ['oily', 'greasy', 'buildup', 'limp'])) concerns.push('oily');
  if (includesAnyKeyword(combined, ['flake', 'dandruff'])) concerns.push('flakes');
  if (includesAnyKeyword(combined, ['chemical', 'treated', 'dyed', 'colored', 'bleached', 'rebonded'])) concerns.push('treated');
  if (!concerns.length || includesAnyKeyword(combined, ['healthy', 'sealed ends', 'good shine'])) concerns.push('healthy');

  return [...new Set(concerns)];
};

const productLineForConcern = (concern: string) => {
  if (!INGREDIENT_SUPPORTED_CONCERNS.has(concern)) return '';
  const options = NON_ADVERTISING_CARE_OPTIONS[concern] || NON_ADVERTISING_CARE_OPTIONS.healthy;
  return `Ingredients that may help: ${options.slice(0, 2).join(' or ')}.`;
};

const appendConcernIngredients = (text: string, concern: string) => {
  const ingredients = productLineForConcern(concern);
  return ingredients ? `${text} ${ingredients}` : text;
};

const addCareSafetyNote = (value: string) => {
  const cleaned = normalizeString(value);
  if (!cleaned) return '';
  if (cleaned.toLowerCase().includes('consult a qualified hair or scalp care professional')) return cleaned;
  return `${cleaned} ${CARE_SAFETY_NOTE}`;
};

const buildFallbackRecommendations = ({
  concerns,
  estimatedLength,
  minimumDonationLengthCm,
}: {
  concerns: string[];
  estimatedLength: number | null;
  minimumDonationLengthCm: number;
}) => {
  const primaryConcern = concerns[0] || 'healthy';
  const rows: { title: string; recommendation_text: string; priority_order: number }[] = [];

  if (estimatedLength == null || estimatedLength < minimumDonationLengthCm || concerns.includes('length')) {
    rows.push({
      title: 'Protect Length Retention',
      recommendation_text: `The visible donation length is not confidently at the ${formatLengthInches(minimumDonationLengthCm)} requirement yet, so focus on gentle handling, reducing breakage, and protecting the ends while growing it out.`,
      priority_order: rows.length + 1,
    });
  }

  if (concerns.includes('damage')) {
    rows.push({
      title: 'Care for Visible Damage',
      recommendation_text: appendConcernIngredients('The photos suggest damage or stressed ends, so trim visibly split tips and reduce heat styling before donation screening.', 'damage'),
      priority_order: rows.length + 1,
    });
  }

  if (concerns.includes('dry')) {
    rows.push({
      title: 'Restore Moisture',
      recommendation_text: appendConcernIngredients('The hair appears dry or dull in the photos, so use conditioner consistently and add a weekly moisturizing treatment on the mid-lengths and ends.', 'dry'),
      priority_order: rows.length + 1,
    });
  }

  if (concerns.includes('frizz')) {
    rows.push({
      title: 'Smooth Frizz Gently',
      recommendation_text: appendConcernIngredients('Visible frizz or flyaways can make the shaft look rough, so dry with a soft towel and use a small amount of smoothing care on the ends.', 'frizz'),
      priority_order: rows.length + 1,
    });
  }

  if (concerns.includes('oily') || concerns.includes('flakes')) {
    rows.push({
      title: concerns.includes('flakes') ? 'Control Visible Flakes' : 'Balance Scalp Oil',
      recommendation_text: appendConcernIngredients('The scalp or roots need clearer balance before donation readiness, so focus cleansing on the scalp and avoid heavy oils near the roots.', concerns.includes('flakes') ? 'flakes' : 'oily'),
      priority_order: rows.length + 1,
    });
  }

  if (concerns.includes('treated')) {
    rows.push({
      title: 'Support Treated Hair',
      recommendation_text: appendConcernIngredients('The photos or history suggest chemical or color treatment, so keep the routine gentle and prioritize repair before donation screening.', 'treated'),
      priority_order: rows.length + 1,
    });
  }

  rows.push({
    title: primaryConcern === 'healthy' ? 'Maintain Donation Readiness' : 'Maintain Hair Between Checks',
    recommendation_text: 'Keep a gentle routine while the hair grows. Avoid tight pulling styles, reduce high heat, detangle carefully, and protect the ends from breakage.',
    priority_order: rows.length + 1,
  });

  return rows.slice(0, 3).map((item, index) => ({ ...item, priority_order: index + 1 }));
};

const enhanceRecommendations = ({
  source,
  detectedCondition,
  visibleDamageNotes,
  summary,
  estimatedLength,
  minimumDonationLengthCm,
}: {
  source: unknown;
  detectedCondition: string;
  visibleDamageNotes: string;
  summary: string;
  estimatedLength: number | null;
  minimumDonationLengthCm: number;
}) => {
  const concerns = inferRecommendationConcerns({
    detectedCondition,
    visibleDamageNotes,
    summary,
    estimatedLength,
    minimumDonationLengthCm,
  });
  const normalized = normalizeRecommendationsV2(source);
  const aligned = recommendationsAlignWithFindings({
    recommendations: normalized,
    detectedCondition,
    visibleDamageNotes,
    estimatedLength,
    minimumDonationLengthCm,
  });
  const rows = aligned && normalized.length >= 3
    ? normalized
    : buildFallbackRecommendations({ concerns, estimatedLength, minimumDonationLengthCm });

  return rows.slice(0, 3).map((item, index) => {
    const concern = concerns[index] || concerns[0] || 'healthy';
    const hasProductLine = item.recommendation_text.toLowerCase().includes('ingredients that may help');
    const shouldAddIngredients = INGREDIENT_SUPPORTED_CONCERNS.has(concern);
    return {
      ...item,
      title: removeAdvertisedNames(item.title),
      recommendation_text: addCareSafetyNote(removeAdvertisedNames(hasProductLine
        ? item.recommendation_text
        : shouldAddIngredients
          ? appendConcernIngredients(item.recommendation_text, concern)
          : item.recommendation_text)),
      priority_order: index + 1,
    };
  });
};

const hasRequirementTreatmentConflict = (
  requirementContext: DonationRequirementContext | null,
  detectedCondition: string,
  visibleDamageNotes: string,
  questionnaireAnswers: Record<string, unknown>,
) => {
  if (!requirementContext) return false;

  const questionnaireText = Object.entries(questionnaireAnswers || {})
    .map(([key, value]) => `${key}: ${String(value ?? '')}`)
    .join(' ');
  const combined = `${detectedCondition} ${visibleDamageNotes} ${questionnaireText}`.toLowerCase();

  if (requirementContext.chemical_treatment_status === false && includesAnyKeyword(combined, ['chemical', 'treated', 'permed', 'relaxed'])) return true;
  if (requirementContext.colored_hair_status === false && includesAnyKeyword(combined, ['dyed', 'colored', 'colour', 'color-treated', 'multiple tones'])) return true;
  if (requirementContext.bleached_hair_status === false && includesAnyKeyword(combined, ['bleach', 'bleached', 'lightened'])) return true;
  if (requirementContext.rebonded_hair_status === false && includesAnyKeyword(combined, ['rebond', 'rebonded', 'straightened chemically'])) return true;

  return false;
};

const buildLengthAssessment = ({
  estimatedLength,
  providedViews,
  missingViews,
  isHairDetected,
  perViewNotes,
}: {
  estimatedLength: number | null;
  providedViews: string[];
  missingViews: string[];
  isHairDetected: boolean;
  perViewNotes: { view: string; clearly_visible: boolean; notes: string }[];
}) => {
  if (!isHairDetected) {
    return 'The current photos were checked using the visible hair areas. Length is estimated conservatively from the clearest visible hair sections.';
  }

  if (missingViews.length) {
    return `The current photos give a partial hair view, so length is estimated conservatively from the visible hair sections. Views checked: ${missingViews.join(', ')}.`;
  }

  const relevantNotes = perViewNotes
    .filter((item) => item.notes)
    .slice(0, 2)
    .map((item) => `${item.view}: ${item.notes}`)
    .join(' ');

  if (estimatedLength != null) {
    return [
      `Based on the current uploaded views, the visible donation length from the lower cheek/neck cut-start area down to the lowest clearly visible ends appears to be about ${formatLengthInches(estimatedLength)}.`,
      'This estimate is limited to the portion of hair that is clearly visible in the current photos.',
      relevantNotes,
    ].filter(Boolean).join(' ');
  }

  return [
    'The current photos do not show both the lower cheek/neck cut-start area and the lowest visible hair ends clearly enough for a reliable numeric donation length estimate.',
    relevantNotes,
  ].filter(Boolean).join(' ');
};

const buildSummaryFromAnalysisFields = ({
  isHairDetected,
  invalidImageReason,
  missingViews,
  detectedTexture,
  detectedDensity,
  detectedCondition,
  visibleDamageNotes,
  decision,
}: {
  isHairDetected: boolean;
  invalidImageReason: string;
  missingViews: string[];
  detectedTexture: string;
  detectedDensity: string;
  detectedCondition: string;
  visibleDamageNotes: string;
  decision: string;
}) => {
  if (!isHairDetected) {
    return invalidImageReason || 'Hair was assessed from the visible areas in the uploaded photos. Final screening requires manual review.';
  }

  if (missingViews.length) {
    return `The current photos allow a partial hair check from the visible sections. Final screening requires manual review.`;
  }

  const observationParts = [
    detectedTexture ? `${detectedTexture.toLowerCase()} hair` : 'visible hair',
    detectedDensity ? `with ${detectedDensity.toLowerCase()} density` : '',
    detectedCondition ? `showing a ${detectedCondition.toLowerCase()} condition` : '',
  ].filter(Boolean);

  const notesPart = visibleDamageNotes
    ? `${visibleDamageNotes.charAt(0).toUpperCase()}${visibleDamageNotes.slice(1)}.`
    : '';

  const decisionPart = decision === ELIGIBLE_STATUS
    ? 'This check suggests the visible condition and length may be suitable for donation.'
    : 'This check suggests the hair still needs improvement before donation readiness.';

  return `${observationParts.join(' ')}. ${notesPart} ${decisionPart} Final screening requires manual review.`
    .replace(/\s+/g, ' ')
    .trim();
};

const hasIncompleteCriticalAnalysisFields = (analysis: Record<string, unknown>) => {
  return Object.keys(analysis).length === 0;
};

const runFocusedLengthFallback = async ({
  model,
  contents,
  providedViews,
}: {
  model: string;
  contents: Array<Record<string, unknown>>;
  providedViews: string[];
}) => {
  try {
    const fallbackResult = await createStructuredResponse({
      providerMode: 'openrouter-only',
      model,
      systemInstruction: [
        'You are a focused hair length estimator for a hair donation app.',
        'Return valid JSON only.',
        'Your main job is to estimate visible donation length from the lower cheek/neck cut-start area to the lowest visible ends in the current images.',
        'Use the front and side profile images for donation length. Use the Hair Scalp only to assess scalp/crown coverage and root/scalp condition.',
        'Set length_measurable=true only when loose or naturally hanging hair shows both the lower cheek/neck cut-start area and the lowest natural ends. Otherwise set length_measurable=false.',
        'If hair is tied back, clipped, folded into a bun, held by a tie/scrunchie, or its natural ends are hidden, return estimated_length=null and explain the obstruction in length_limit_reason. Never measure the distance to a clip, bun, or tied section.',
        'If length_measurable=true, return a conservative approximate estimated_length in centimeters for storage even when no ruler is present.',
        'Use face/head/body proportions and landmarks for donation length from lower cheek/neck to ends: shoulder-length is usually about 4-8 inches, collarbone about 6-10 inches, upper chest about 8-12 inches, armpit about 10-14 inches, mid-back about 15-24 inches, waist about 24-32 inches.',
        'Do not estimate eligible donation length when the visible ends only reach the shoulder, collarbone, or upper chest. Eligibility requires a clear lower cheek/neck-to-ends length above the current database minimum hair length requirement.',
        'Return null whenever length_measurable=false or the lower cheek/neck cut-start area or natural lowest ends are blocked, tied, clipped, covered, or cropped.',
        'Write length_assessment in inches only and mention the lower cheek/neck start point.',
        'Do not reject ordinary eyeglasses unless they hide the hairline or hair.',
      ].join('\n'),
      responseJsonSchema: lengthFallbackSchema,
      maxOutputTokens: 1600,
      temperature: 0.1,
      reasoningEffort: 'minimal',
      includeDiagnostics: true,
      contents,
    }) as { parsed: Record<string, unknown>; diagnostics: Record<string, unknown> };

    const source = fallbackResult?.parsed?.analysis && typeof fallbackResult.parsed.analysis === 'object'
      ? fallbackResult.parsed.analysis
      : fallbackResult?.parsed;
    const focused = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>;
    const lengthMeasurable = focused?.length_measurable !== false;
    const lengthLimitReason = normalizeString(focused?.length_limit_reason);
    const estimatedLength = lengthMeasurable ? normalizeNumber(focused?.estimated_length) : null;
    const lengthAssessment = normalizeString(focused?.length_assessment);

    console.info('[analyze-hair-submission] focused length fallback completed', {
      hasEstimatedLength: estimatedLength != null,
      estimatedLength,
      hasLengthAssessment: Boolean(lengthAssessment),
      providerResponseStatus: fallbackResult?.diagnostics?.provider_response_status ?? null,
      providerParseSuccess: fallbackResult?.diagnostics?.provider_parse_success ?? null,
    });

    if (!Object.keys(focused).length) return null;

    return {
      is_hair_detected: focused?.is_hair_detected !== false,
      invalid_image_reason: '',
      missing_views: [],
      per_view_notes: providedViews.map((view) => ({
        view,
        clearly_visible: true,
        notes: lengthAssessment || 'Focused length fallback reviewed this view for visible cheek/neck-to-ends donation length.',
      })),
      estimated_length: estimatedLength,
      length_measurable: lengthMeasurable && estimatedLength != null,
      length_limit_reason: lengthLimitReason,
      detected_color: normalizeString(focused?.detected_color) || 'Black',
      detected_texture: normalizeString(focused?.detected_texture) || 'Straight',
      detected_density: normalizeString(focused?.detected_density) || 'Medium',
      detected_condition: normalizeString(focused?.detected_condition) || 'Needs manual hair review',
      visible_damage_notes: 'Hair is visible in the submitted photos. Detailed condition scoring should be confirmed during manual screening.',
      confidence_score: normalizeConfidence(focused?.confidence_score) ?? (estimatedLength != null ? 0.56 : 0.42),
      shine_level: 5,
      frizz_level: 4,
      dryness_level: 4,
      oiliness_level: 3,
      damage_level: 4,
      bald_spots_present: false,
      affected_regions: ['none'],
      hair_density_score: 50,
      shedding_level: 'mild',
      visible_scalp_area: 'low',
      scalp_coverage_notes: 'Hair and scalp view were submitted; coverage should be tracked again in the next scan for a stronger comparison.',
      dandruff_detected: false,
      dandruff_severity: 'none',
      dandruff_notes: 'No visible dandruff-like flakes were confirmed in this low-confidence fallback.',
      lice_detected: false,
      lice_confidence: 'none',
      lice_notes: 'No visible lice or nit-like signs were confirmed in this low-confidence fallback.',
      improvement_tracking_status: 'Needs improvement tracking',
      improvement_recommendation: 'Track scalp coverage and hair density over time, and use gentle care that avoids tight pulling or harsh handling.',
      decision: IMPROVE_STATUS,
      summary: normalizeString(focused?.summary) || (
        estimatedLength != null
          ? `Focused fallback estimated visible donation length at about ${formatLengthInches(estimatedLength)}. Final screening requires manual review.`
          : 'Focused fallback could not confirm a numeric visible length. Final screening requires manual review.'
      ),
      length_assessment: lengthAssessment || (
        estimatedLength != null
          ? `Focused fallback estimated visible cheek/neck-to-ends donation length at about ${formatLengthInches(estimatedLength)} using body-landmark proportions.`
          : 'The focused fallback could not see both the lower cheek/neck cut-start area and the lowest ends clearly enough for a numeric estimate.'
      ),
      donation_readiness_note: '',
      history_assessment: '',
      recommendations: [
        {
          title: estimatedLength != null ? 'Protect Length Retention' : 'Track Length Progress',
          recommendation_text: estimatedLength != null
            ? 'Keep hair loose and reduce breakage while growing toward donation length.'
            : 'Keep hair loose and protect the ends so length progress can be checked over time.',
          priority_order: 1,
        },
        {
          title: 'Use Side Profile for Length',
          recommendation_text: 'The side profile should show the lower cheek or neck cut-start area and the lowest visible ends in one frame.',
          priority_order: 2,
        },
        {
          title: 'Keep Ends Visible',
          recommendation_text: 'Keep the ends centered and uncovered so the cut line and donation length can be checked.',
          priority_order: 3,
        },
      ],
    };
  } catch (error) {
    console.warn('[analyze-hair-submission] focused length fallback failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const resolveSafeAnalysisError = (error: unknown) => {
  const message = normalizeString(error instanceof Error ? error.message : String(error || ''));
  const technicalMessage = message.toLowerCase();

  if (!message) {
    return {
      status: 500,
      message: 'We could not analyze the hair photos right now. Please try again.',
    };
  }

  if (
    technicalMessage.includes('guided donation questions')
    || technicalMessage.includes('guided hair questions')
    || technicalMessage.includes('compliance checklist')
    || technicalMessage.includes('required hair views')
    || technicalMessage.includes('clear hair photo')
    || technicalMessage.includes('no valid image payload')
  ) {
    return { status: 422, message };
  }

  if (
    technicalMessage.includes('too large')
    || technicalMessage.includes('maximum context length')
    || technicalMessage.includes('request entity too large')
    || technicalMessage.includes('413')
  ) {
    return {
      status: 422,
      message: 'The uploaded photos are too large for analysis right now. Please retake or upload clearer but smaller images.',
    };
  }

  if (
    technicalMessage.includes('unsupported image')
    || technicalMessage.includes('invalid image')
    || technicalMessage.includes('does not represent a valid image')
    || technicalMessage.includes('image parse')
    || technicalMessage.includes('image_url')
  ) {
    return {
      status: 422,
      message: 'One of the uploaded photos could not be processed for AI analysis. Please retake or upload that view again.',
    };
  }

  if (
    technicalMessage.includes('api key is not configured')
    || technicalMessage.includes('not configured in edge function secrets')
  ) {
    return {
      status: 500,
      message: 'Hair analysis is not configured on the server right now.',
    };
  }

  if (
    technicalMessage.includes('quota exceeded')
    || technicalMessage.includes('rate limit')
    || technicalMessage.includes('resource exhausted')
    || technicalMessage.includes('free tier')
    || technicalMessage.includes('retry in')
  ) {
    return {
      status: 429,
      message: 'Hair analysis is busy right now. Please wait a moment, then try again.',
    };
  }

  return {
    status: 500,
    message,
  };
};

const formatRequirementContext = (requirementContext: DonationRequirementContext | null) => {
  if (!requirementContext) {
    return 'No donation requirement context was available for this screening.';
  }

  return [
    `donation_requirement_id: ${requirementContext.donation_requirement_id ?? 'not provided'}`,
    `minimum_hair_length_cm: ${requirementContext.minimum_hair_length ?? 'not provided'}`,
    `minimum_hair_length_inches: ${requirementContext.minimum_hair_length_inches ?? 'not provided'}`,
    `chemical_treatment_allowed: ${requirementContext.chemical_treatment_status ?? 'unknown'}`,
    `colored_hair_allowed: ${requirementContext.colored_hair_status ?? 'unknown'}`,
    `bleached_hair_allowed: ${requirementContext.bleached_hair_status ?? 'unknown'}`,
    `rebonded_hair_allowed: ${requirementContext.rebonded_hair_status ?? 'unknown'}`,
    `hair_texture_status: ${normalizeString(requirementContext.hair_texture_status) || 'not provided'}`,
    `notes: ${normalizeString(requirementContext.notes) || 'not provided'}`,
  ].join('\n');
};

const formatSubmissionContext = (submissionContext: SubmissionContext | null) => {
  if (!submissionContext?.submission_id) {
    return 'No prior submission context was provided.';
  }

  return [
    `submission_id: ${submissionContext.submission_id}`,
    `donation_drive_id: ${submissionContext.donation_drive_id ?? 'not provided'}`,
    `organization_id: ${submissionContext.organization_id ?? 'not provided'}`,
    `detail_id: ${submissionContext.detail_id ?? 'not provided'}`,
    `declared_length: ${submissionContext.declared_length ?? 'not provided'}`,
    `declared_texture: ${normalizeString(submissionContext.declared_texture) || 'not provided'}`,
    `declared_density: ${normalizeString(submissionContext.declared_density) || 'not provided'}`,
    `declared_condition: ${normalizeString(submissionContext.declared_condition) || 'not provided'}`,
  ].join('\n');
};

const formatHistoryContext = (historyContext: HistoryContext | null) => {
  if (!historyContext?.entries?.length) {
    return 'No prior hair-check history was provided.';
  }

  return [
    `total_checks: ${historyContext.total_checks ?? historyContext.entries.length}`,
    `latest_condition: ${normalizeString(historyContext.latest_condition) || 'not provided'}`,
    `latest_check_at: ${normalizeString(historyContext.latest_check_at) || 'not provided'}`,
    'Recent checks:',
    ...historyContext.entries.slice(0, 6).map((entry, index) => (
      `${index + 1}. created_at=${normalizeString(entry.created_at) || 'not provided'} | condition=${normalizeString(entry.detected_condition) || 'not provided'} | decision=${normalizeString(entry.decision) || 'not provided'} | estimated_length=${normalizeNumber(entry.estimated_length) ?? 'not provided'} | summary=${normalizeString(entry.summary) || 'not provided'}`
    )),
  ].join('\n');
};

const formatQuestionnaireAnswers = (answers: Record<string, unknown> = {}) => (
  Object.entries(answers)
    .map(([key, value]) => `${key}: ${value === '' || value === null || value === undefined ? 'not provided' : String(value)}`)
    .join('\n')
);

const isDonationConditionAcceptable = (condition: string, visibleDamageNotes: string) => {
  const normalizedCondition = condition.toLowerCase();
  const normalizedNotes = visibleDamageNotes.toLowerCase();
  const combined = `${normalizedCondition} ${normalizedNotes}`;

  if (!normalizedCondition) return false;
  if (normalizedCondition.includes('healthy')) return true;
  if (includesAnyKeyword(combined, [
    'severe damage',
    'major damage',
    'extensive damage',
    'heavy breakage',
    'significant breakage',
    'chemical damage',
    'split ends throughout',
    'not suitable',
  ])) return false;

  return !includesAnyKeyword(combined, ['bleached', 'rebonded']);
};

const scoreConditionForTrend = (condition: string) => {
  const normalized = condition.toLowerCase();
  if (normalized.includes('healthy') || normalized.includes('good')) return 4;
  if (normalized.includes('oily')) return 3;
  if (normalized.includes('dry') || normalized.includes('frizz')) return 2;
  if (normalized.includes('damage') || normalized.includes('treated')) return 1;
  return 2;
};

const inferHistoryAssessment = (historyContext: HistoryContext | null, currentCondition: string, currentLength: number | null) => {
  if (!historyContext?.entries?.length) return '';

  const latestPrior = historyContext.entries[0];
  if (!latestPrior) return '';

  const priorCondition = normalizeString(latestPrior.detected_condition);
  const priorLength = normalizeNumber(latestPrior.estimated_length);
  const currentScore = scoreConditionForTrend(currentCondition);
  const priorScore = scoreConditionForTrend(priorCondition);

  if (currentScore > priorScore) {
    return 'Compared with your most recent saved check, the current photos suggest better overall hair condition and improved donation readiness.';
  }

  if (currentScore < priorScore) {
    return 'Compared with your most recent saved check, the current photos suggest more visible care needs, so improving condition should come before donation planning.';
  }

  if (currentLength != null && priorLength != null) {
    if (currentLength > priorLength + 1) {
      return 'Compared with your most recent saved check, the condition looks similar but the visible length appears improved.';
    }
    if (currentLength < priorLength - 1) {
      return 'Compared with your most recent saved check, the visible length appears shorter or less clearly retained, so focus on preserving length.';
    }
  }

  return 'Compared with your most recent saved check, the overall appearance looks similar.';
};

const inferQuestionnaireAssessment = (questionnaireAnswers: Record<string, unknown>) => {
  const notes: string[] = [];
  const scalpItch = normalizeString(questionnaireAnswers?.scalp_itch).toLowerCase();
  const dandruff = normalizeString(questionnaireAnswers?.dandruff_or_flakes).toLowerCase();
  const oilyAfterWash = normalizeString(questionnaireAnswers?.oily_after_wash).toLowerCase();
  const dryOrRough = normalizeString(questionnaireAnswers?.dry_or_rough).toLowerCase();
  const hairFall = normalizeString(questionnaireAnswers?.hair_fall).toLowerCase();
  const heatUse = normalizeString(questionnaireAnswers?.heat_use_since_last_check || questionnaireAnswers?.heat_use_frequency).toLowerCase();
  const chemical = normalizeString(questionnaireAnswers?.chemical_treatment_since_last_check || questionnaireAnswers?.chemical_process_history).toLowerCase();
  const hairTexture = normalizeString(questionnaireAnswers?.hair_texture);

  if (scalpItch === 'often' || dandruff === 'a_lot') {
    notes.push('Questionnaire reports scalp discomfort/flakes, so prioritize scalp-soothing and anti-buildup care.');
  }
  if (oilyAfterWash === 'yes') {
    notes.push('Questionnaire reports quick oil buildup, so include balanced root-cleansing guidance.');
  }
  if (['yes', 'dry', 'rough', 'damaged', 'brittle', 'frizzy'].includes(dryOrRough)) {
    notes.push(`Questionnaire reports ${dryOrRough === 'yes' ? 'dryness/roughness' : dryOrRough}, so prioritize care that matches that reported condition alongside the photo findings.`);
  }
  if (hairFall === 'yes') {
    notes.push('Questionnaire reports hair fall, so include breakage-minimizing and scalp-monitoring guidance.');
  }
  if (heatUse === 'often') {
    notes.push('Questionnaire reports frequent heat use, so reinforce heat protection and reduced heat frequency.');
  }
  if (chemical === 'yes') {
    notes.push('Questionnaire reports chemical treatment history, so emphasize strengthening and gentle care.');
  }
  if (hairTexture) {
    notes.push(`Questionnaire reports ${hairTexture} hair type, so interpret visible length and care needs with that pattern in mind.`);
  }

  return notes.join(' ');
};

const normalizeAnalysisPayload = (
  analysis: Record<string, unknown>,
  providedViews: string[],
  concernType: string,
  requirementContext: DonationRequirementContext | null,
  questionnaireAnswers: Record<string, unknown>,
  historyContext: HistoryContext | null,
) => {
  const isHairDetected = analysis?.is_hair_detected !== false;
  const normalizedMissingViews = normalizeMissingViews(analysis?.missing_views);
  const normalizedViewNotes = normalizePerViewNotes(analysis?.per_view_notes);
  const detectedColor = normalizeString(analysis?.detected_color);
  const detectedTexture = normalizeHairTexture(analysis?.detected_texture, questionnaireAnswers);
  const detectedDensity = normalizeString(analysis?.detected_density);
  const detectedCondition = normalizeString(analysis?.detected_condition);
  const invalidImageReason = normalizeString(analysis?.invalid_image_reason);
  const visibleDamageNotes = normalizeString(analysis?.visible_damage_notes);
  const confidenceScore = normalizeConfidence(analysis?.confidence_score);
  const lengthAssessment = normalizeString(analysis?.length_assessment);
  const lengthLimitReason = normalizeString(analysis?.length_limit_reason);
  const lengthEvidenceText = [
    lengthAssessment,
    lengthLimitReason,
    normalizeString(analysis?.summary),
    visibleDamageNotes,
    ...normalizedViewNotes.map((item) => item.notes),
  ].join(' ');
  const approximateLengthFromText = inferApproximateLengthFromText(lengthEvidenceText);
  const lengthMeasurable = analysis?.length_measurable !== false
    && !hasUnmeasurableLengthEvidence(lengthEvidenceText);
  const estimatedLength = lengthMeasurable
    ? normalizeEstimatedLengthCm(analysis?.estimated_length, lengthEvidenceText) ?? approximateLengthFromText
    : null;
  const rawShineLevel = normalizeLevel10(analysis?.shine_level, detectedCondition.toLowerCase().includes('healthy') ? 7 : 5);
  const rawFrizzLevel = normalizeLevel10(analysis?.frizz_level, detectedCondition.toLowerCase().includes('frizz') ? 8 : 3);
  const rawDrynessLevel = normalizeLevel10(analysis?.dryness_level, detectedCondition.toLowerCase().includes('dry') ? 8 : 3);
  const rawOilinessLevel = normalizeLevel10(analysis?.oiliness_level, detectedCondition.toLowerCase().includes('oily') ? 8 : 2);
  const rawDamageLevel = normalizeLevel10(analysis?.damage_level, detectedCondition.toLowerCase().includes('damage') ? 8 : 3);
  const baldSpotsPresent = analysis?.bald_spots_present === true;
  const affectedRegions = normalizeMissingViews(analysis?.affected_regions);
  const finalAffectedRegions = affectedRegions.length ? affectedRegions : ['none'];
  const rawDensityScore = normalizeNumber(analysis?.hair_density_score);
  const hairDensityScore = rawDensityScore == null ? 50 : Math.max(0, Math.min(100, rawDensityScore));
  const questionnaireHairFall = normalizeString(questionnaireAnswers?.hair_fall).toLowerCase();
  const fallbackSheddingLevel = questionnaireHairFall === 'no' ? 'none' : 'mild';
  const sheddingLevel = normalizeSheddingLevel(analysis?.shedding_level, fallbackSheddingLevel);
  const visibleScalpArea = normalizeString(analysis?.visible_scalp_area) || (baldSpotsPresent ? 'moderate' : 'none');
  const scalpCoverageNotes = normalizeString(analysis?.scalp_coverage_notes);
  const scalpFindingEvidenceText = [
    normalizeString(analysis?.summary),
    normalizeString(analysis?.visible_damage_notes),
    scalpCoverageNotes,
    ...normalizedViewNotes
      .filter((item) => String(item?.view || '').toLowerCase().includes('scalp'))
      .map((item) => item.notes),
  ].join(' ');
  const hasDandruffTextEvidence = hasVisibleDandruffEvidence(scalpFindingEvidenceText);
  const dandruffDetected = analysis?.dandruff_detected === true || hasDandruffTextEvidence;
  const dandruffSeverity = normalizeString(analysis?.dandruff_severity) || (dandruffDetected ? 'mild' : 'none');
  const dandruffNotes = normalizeString(analysis?.dandruff_notes);
  const liceDetected = analysis?.lice_detected === true;
  const liceConfidence = normalizeString(analysis?.lice_confidence) || (liceDetected ? 'medium' : 'none');
  const liceNotes = normalizeString(analysis?.lice_notes);
  const hasCoverageConcern = baldSpotsPresent
    || ['moderate', 'high'].includes(visibleScalpArea.toLowerCase())
    || ['moderate', 'severe'].includes(sheddingLevel.toLowerCase())
    || (hairDensityScore != null && hairDensityScore < 45);
  const hasScalpFindingConcern = dandruffDetected || liceDetected;

  // Correct level values that contradict the AI's own text observations
  const combinedText = [
    normalizeString(analysis?.summary),
    normalizeString(analysis?.visible_damage_notes),
  ].join(' ').toLowerCase();
  const conditionLower = detectedCondition.toLowerCase();

  // Shine: if the AI describes the hair as shiny or healthy but returned a very low shine, correct it
  const aiDescribesShiny = combinedText.includes('shin') || conditionLower.includes('healthy');
  const shineLevel = (rawShineLevel < 5 && aiDescribesShiny) ? Math.max(rawShineLevel, 7) : rawShineLevel;

  // Damage: if the AI explicitly says no visible damage but returned a high damage level, correct it
  const aiDescribesNoDamage = combinedText.includes('no visible damage') || combinedText.includes('no damage') || (conditionLower.includes('healthy') && !combinedText.includes('split') && !combinedText.includes('fray') && !combinedText.includes('breakage'));
  const damageLevel = (rawDamageLevel > 4 && aiDescribesNoDamage) ? Math.min(rawDamageLevel, 2) : rawDamageLevel;

  const frizzLevel = rawFrizzLevel;
  const drynessLevel = rawDrynessLevel;
  const oilinessLevel = rawOilinessLevel;
  const inferredMissingViews = expectedViews.filter((view) => !providedViews.includes(view));
  const missingViews = [...new Set([...inferredMissingViews, ...normalizedMissingViews])];
  const configuredMinimumDonationLengthCm = Number(requirementContext?.minimum_hair_length);
  const minimumDonationLengthCm = Number.isFinite(configuredMinimumDonationLengthCm) && configuredMinimumDonationLengthCm > 0
    ? configuredMinimumDonationLengthCm
    : null;
  const endpointEvidenceText = [
    lengthAssessment,
    normalizeString(analysis?.summary),
    visibleDamageNotes,
    ...normalizedViewNotes.map((item) => item.notes),
  ].join(' ');
  const hasBelowThresholdEndpointLandmark = (
    (minimumDonationLengthCm != null && approximateLengthFromText != null && approximateLengthFromText < minimumDonationLengthCm)
    || hasShortEndpointLandmark(endpointEvidenceText)
  );
  const finalEstimatedLength = !lengthMeasurable
    ? null
    : hasBelowThresholdEndpointLandmark && estimatedLength != null
      ? Math.min(estimatedLength, approximateLengthFromText ?? (minimumDonationLengthCm != null ? minimumDonationLengthCm - 0.1 : estimatedLength))
      : estimatedLength;
  const donationReadinessNote = normalizeString(analysis?.donation_readiness_note);
  const historyAssessment = normalizeString(analysis?.history_assessment) || inferHistoryAssessment(
    historyContext,
    detectedCondition,
    finalEstimatedLength,
  );
  const questionnaireAssessment = inferQuestionnaireAssessment(questionnaireAnswers);
  const conditionAcceptable = isDonationConditionAcceptable(detectedCondition, visibleDamageNotes);
  const treatmentConflict = hasRequirementTreatmentConflict(
    requirementContext,
    detectedCondition,
    visibleDamageNotes,
    questionnaireAnswers,
  );
  const hasClearEnoughEvidence = isHairDetected && !missingViews.length && confidenceScore != null && confidenceScore >= MIN_ELIGIBILITY_CONFIDENCE;
  const hasDonationRequirement = minimumDonationLengthCm != null;
  const meetsLengthRule = hasDonationRequirement && finalEstimatedLength != null && finalEstimatedLength >= minimumDonationLengthCm && !hasBelowThresholdEndpointLandmark;

  let decision = normalizeString(analysis?.decision) === ELIGIBLE_STATUS
    ? ELIGIBLE_STATUS
    : IMPROVE_STATUS;
  if (!hasDonationRequirement || !hasClearEnoughEvidence || !meetsLengthRule || !conditionAcceptable || treatmentConflict || hasCoverageConcern || hasScalpFindingConcern) {
    decision = IMPROVE_STATUS;
  } else if (concernType === 'donation_eligibility') {
    decision = ELIGIBLE_STATUS;
  }

  const summary = normalizeString(analysis?.summary) || buildSummaryFromAnalysisFields({
    isHairDetected,
    invalidImageReason,
    missingViews,
    detectedTexture,
    detectedDensity,
    detectedCondition,
    visibleDamageNotes,
    decision,
  });
  const normalizedRecommendations = enhanceRecommendations({
    source: analysis?.recommendations,
    detectedCondition,
    visibleDamageNotes,
    summary,
    estimatedLength: finalEstimatedLength,
    minimumDonationLengthCm,
  });
  const finalIsHairDetected = true;
  const finalInvalidImageReason = '';
  const improvementRecommendation = normalizeString(analysis?.improvement_recommendation) || (
    liceDetected
      ? 'Pause donation plans and consult a qualified health or scalp care professional before donating.'
      : dandruffDetected
        ? 'Use gentle scalp care and track whether visible flakes improve before donation.'
        : hasCoverageConcern
          ? 'Repeat the same photo views over time to track visible scalp coverage and density changes, and use gentle scalp and hair care while monitoring progress.'
          : 'Keep tracking hair length and condition with future CheckHair scans before donating.'
  );
  const minimumLengthMessage = minimumDonationLengthCm != null && finalEstimatedLength != null && !meetsLengthRule
    ? `The estimated donation length is ${formatLengthInches(finalEstimatedLength)}, below the ${formatLengthInches(minimumDonationLengthCm)} requirement. Continue caring for and growing the hair before checking again.`
    : '';
  const finalImprovementTrackingStatus = decision === ELIGIBLE_STATUS
    ? 'Ready for donation'
    : 'Not eligible for donation yet';
  const finalImprovementRecommendation = minimumLengthMessage || improvementRecommendation;
  const finalDonationReadinessNote = decision === ELIGIBLE_STATUS
    ? donationReadinessNote
    : minimumLengthMessage;

  return {
    is_hair_detected: finalIsHairDetected,
    invalid_image_reason: finalInvalidImageReason,
    missing_views: missingViews,
    per_view_notes: normalizedViewNotes,
    estimated_length: finalEstimatedLength,
    length_measurable: lengthMeasurable && finalEstimatedLength != null,
    length_limit_reason: lengthMeasurable
      ? ''
      : lengthLimitReason || 'Hair was tied, clipped, covered, cropped, or did not show the naturally hanging lowest ends clearly enough for a reliable measurement.',
    detected_color: detectedColor || 'Black',
    detected_texture: detectedTexture || 'Straight',
    detected_density: detectedDensity || 'Medium',
    detected_condition: detectedCondition || 'Needs manual hair review',
    visible_damage_notes: visibleDamageNotes,
    confidence_score: confidenceScore ?? 0,
    shine_level: shineLevel,
    frizz_level: frizzLevel,
    dryness_level: drynessLevel,
    oiliness_level: oilinessLevel,
    damage_level: damageLevel,
    bald_spots_present: baldSpotsPresent,
    affected_regions: finalAffectedRegions,
    hair_density_score: hairDensityScore,
    shedding_level: sheddingLevel,
    visible_scalp_area: visibleScalpArea,
    scalp_coverage_notes: scalpCoverageNotes || (
      hasCoverageConcern
        ? 'This check suggests visible scalp coverage or shedding concerns that are better tracked over time.'
        : 'No clear bald spots or patchy low-coverage areas were observed in the uploaded views.'
    ),
    dandruff_detected: dandruffDetected,
    dandruff_severity: dandruffSeverity,
    dandruff_notes: dandruffNotes || (
      dandruffDetected
        ? 'Dandruff-like flakes were observed in the uploaded scalp or root views.'
        : 'No visible dandruff-like flakes were observed in the uploaded views.'
    ),
    lice_detected: liceDetected,
    lice_confidence: liceConfidence,
    lice_notes: liceNotes || (
      liceDetected
        ? 'Visible lice or nit-like signs were observed; this screening is not a medical diagnosis.'
        : 'No visible lice or nit-like signs were observed in the uploaded views.'
    ),
    improvement_tracking_status: finalImprovementTrackingStatus,
    improvement_recommendation: finalImprovementRecommendation,
    decision,
    summary,
    length_assessment: !lengthMeasurable
      ? lengthLimitReason || 'Hair length could not be measured because the hair was tied, clipped, covered, cropped, or the naturally hanging lowest ends were not visible. Retake the length views with loose hair and no accessories.'
      : lengthAssessment || buildLengthAssessment({
        estimatedLength: finalEstimatedLength,
        providedViews,
        missingViews,
        isHairDetected,
        perViewNotes: normalizedViewNotes,
      }),
    donation_readiness_note: finalDonationReadinessNote,
    history_assessment: [historyAssessment, questionnaireAssessment].filter(Boolean).join(' '),
    recommendations: normalizedRecommendations,
  };
};

// Extract base64 data from a data URL (strips the "data:mime/type;base64," prefix)
const extractBase64Data = (dataUrl: string): string => {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
};

// Extract MIME type from a data URL
const extractMimeType = (dataUrl: string): string => {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  return match?.[1] || 'image/jpeg';
};

Deno.serve(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;

  try {
    const body = await request.json();
    const images = Array.isArray(body?.images) ? body.images.filter(Boolean) as HairImage[] : [];
    const concernType = normalizeString(body?.concern_type) || 'donation_eligibility';
    const questionnaireAnswers = body?.questionnaire_answers && typeof body.questionnaire_answers === 'object'
      ? body.questionnaire_answers as Record<string, unknown>
      : {};
    const donationRequirementContext = body?.donation_requirement_context && typeof body.donation_requirement_context === 'object'
      ? body.donation_requirement_context as DonationRequirementContext
      : null;
    const complianceContext = body?.compliance_context && typeof body.compliance_context === 'object'
      ? body.compliance_context as ComplianceContext
      : null;
    const submissionContext = body?.submission_context && typeof body.submission_context === 'object'
      ? body.submission_context as SubmissionContext
      : null;
    const historyContext = body?.history_context && typeof body.history_context === 'object'
      ? body.history_context as HistoryContext
      : null;

    if (!images.length) {
      return createJsonResponse({
        error: 'Please upload at least one clear hair photo before analysis.',
        edge_function_invoked: true,
        provider_request_attempted: false,
      }, 400);
    }

    if (!normalizeString(questionnaireAnswers?.screening_intent)) {
      return createJsonResponse({
        error: 'Please complete the guided hair questions before analysis.',
        edge_function_invoked: true,
        provider_request_attempted: false,
      }, 422);
    }

    if (!complianceContext?.acknowledged) {
      return createJsonResponse({
        error: 'Please confirm the photo compliance checklist before analysis.',
        edge_function_invoked: true,
        provider_request_attempted: false,
      }, 422);
    }

    const validImages = images.filter((image) => typeof image?.dataUrl === 'string' && image.dataUrl.startsWith('data:'));
    const photosVerified = await verifyHairPhotoVerificationToken({
      token: normalizeString(complianceContext?.photo_verification_token),
      images,
    });
    if (!photosVerified) {
      return createJsonResponse({
        error: 'Your photo check is missing or has expired. Please verify the captured photos again before analysis.',
        error_type: 'photo_verification_required',
        edge_function_invoked: true,
        provider_request_attempted: false,
      }, 422);
    }

    const providedViews = new Set(
      validImages
        .flatMap((image) => getImageCanonicalViewLabels(image))
        .filter(Boolean)
    );
    const missingProvidedViews = expectedViews.filter((view) => !providedViews.has(view));

    if (missingProvidedViews.length) {
      return createJsonResponse({
        error: `Please add these required hair views before analysis: ${missingProvidedViews.join(', ')}.`,
        edge_function_invoked: true,
        provider_request_attempted: false,
      }, 422);
    }

    const model = resolveOpenRouterHairVisionModel(
      Deno.env.get('OPENROUTER_HAIR_ANALYSIS_MODEL'),
    );
    const hasOpenRouterKey = Boolean(Deno.env.get('OPENROUTER_API_KEY'));

    console.info('[analyze-hair-submission] invoked', {
      concernType,
      imageCount: images.length,
      validImageCount: validImages.length,
      providedViews: Array.from(providedViews),
      missingProvidedViews,
      hasQuestionnaireAnswers: Boolean(Object.keys(questionnaireAnswers).length),
      hasComplianceContext: Boolean(complianceContext?.acknowledged),
      hasDonationRequirementContext: Boolean(donationRequirementContext),
      hasSubmissionContext: Boolean(submissionContext?.submission_id),
      historyEntryCount: Array.isArray(historyContext?.entries) ? historyContext.entries.length : 0,
      hasOpenRouterKey,
      model,
    });

    // Build text context
    const textContent = [
      '=== HAIR ANALYSIS REQUEST ===',
      `concern_type: ${concernType}`,
      `screening_intent: ${normalizeString(questionnaireAnswers?.screening_intent) || 'not provided'}`,
      `photo_compliance_acknowledged: ${complianceContext?.acknowledged === true ? 'yes' : 'no'}`,
      '',
      '=== REQUIRED IMAGE ROLES ===',
      buildRequiredViewRoleText(),
      '',
      '=== CURRENT PROVIDED IMAGES ===',
      formatProvidedImageRoles(validImages),
      '',
      '=== STEP 1: INSPECT EACH UPLOADED PHOTO ===',
      'Before generating any output, carefully look at each photo for the following:',
      '- Environment: Is it well-lit? Is it dark/underexposed? Is there a person visible?',
      '- Background: Is there only one person? Are there distracting items behind the subject?',
      '- Required angle: Is the Front View face-forward? Are the Side Profile and Right Side Photo actually side views? Does the Hair Scalp show the scalp/crown or part line clearly? Does Back Hair Photo show hair from behind when provided?',
      '- Cross-view consistency: Do all provided photos appear to show the same current hair from one person? Check visible hair color, length, texture, density, ends, hairline/parting when visible, back-side fullness, and clothing/shoulder area when visible. Do not identify the person; only check whether the submission is visually consistent.',
      '- Accessories: Are glasses, sunglasses, masks, face shields, caps, hats, headbands, clips, pins, hair ties, scrunchies, scarves, headphones, hoods, hands, towels, or fabric visible on the face or blocking the hairline, shaft, length, or ends?',
      '- Hair authenticity screening: Look conservatively for visible wig, hairpiece, topper, or extension evidence such as a lace edge, wig cap, exposed track/weft, tape or bond, attachment seam, or abrupt unmatched density/texture. Do not infer artificial hair from styling, high density, straightening, curling, or color alone. Record only visible evidence in per_view_notes and lower confidence when roots or the hairline are obscured.',
      '- Scalp condition, roots, hair shaft shine or dullness, texture, density, ends condition',
      '- Score levels: shine, frizz, dryness, oiliness, damage from 1-10',
      'Use per_view_notes to record what you observe in each view.',
      '',
      '=== STEP 2: STRUCTURED QUESTIONNAIRE CONTEXT (REQUIRED INTEGRATION) ===',
      'Use questionnaire answers as required context for summary and recommendations.',
      'Photos stay primary for visual findings, but recommendations must reflect relevant reported risks (itch, flakes, oiliness, dryness, hair fall, frequent heat, chemical treatment).',
      formatQuestionnaireAnswers(questionnaireAnswers),
      '',
      '=== STEP 3: PRIOR HAIR-CHECK HISTORY ===',
      formatHistoryContext(historyContext),
      '',
      '=== STEP 4: DONATION REQUIREMENT CONTEXT ===',
      formatRequirementContext(donationRequirementContext),
      '',
      '=== STEP 5: PREVIOUS SUBMISSION CONTEXT ===',
      formatSubmissionContext(submissionContext),
      '',
      '=== STEP 6: GENERATE RESULT ===',
      'Based on what you see in the photos and the questionnaire context:',
      'The current result must come from the current uploaded photos only.',
      'Return one per_view_notes entry for every provided current image, including optional back-side and hair-ends views when present.',
      'For the Hair Scalp image, carefully inspect the part line, roots, crown, and visible hair shafts for dandruff-like flakes, lice, and nits before finalizing. The final JSON must always include dandruff_detected, dandruff_severity, dandruff_notes, lice_detected, lice_confidence, and lice_notes.',
      'Dandruff/flakes and lice/nits are different findings. Dandruff/flakes: mark detected when visible white/yellow loose or irregular flake-like particles or buildup appear on the scalp/roots/part line. Lice/nits: mark detected only when insects or attached oval nit-like particles on hair shafts are clearly visible; otherwise use lice_confidence low/none with notes.',
      'Do not reject the photo set in this step. The photo set already passed validation, so return the closest conservative hair analysis and keep is_hair_detected=true.',
      'Recommendations must be about hair care, condition maintenance, length retention, scalp care, or visible damage. Do not put photo capture, retake, lighting, upload, framing, or recheck instructions in recommendations.',
      'If questionnaire answers report at least one risk, at least one recommendation must directly address that reported risk.',
      'Visible donation length must be at least the current database minimum hair length requirement from the lower cheek/neck cut-start area for donation eligibility.',
      `Use "${ELIGIBLE_STATUS}" only when visible condition is suitable, confidence_score is at least ${MIN_ELIGIBILITY_CONFIDENCE}, all required views are clearly visible, and the visible endpoint is around armpit or longer. Shoulder, collarbone, or upper-chest length is not eligible.`,
      'If donation requirements disallow colored, bleached, rebonded, or chemically treated hair and the photos or questionnaire suggest that treatment, mark the result as needing improvement or manual review.',
      'Do not recommend or advertise products. Include neutral ingredients only when they clearly fit a visible concern: dryness, visible damage, frizz, visible flakes, oily roots, or chemically treated hair. Skip ingredients when the recommendation is only about length, maintenance, retaking photos, or rechecking. Do not include brand names, company names, store names, marketplaces, shopping links, advertised product names, countries, country-made products, or country-specific product options. If ingredients are mentioned, include a short caution that users with allergies, scalp irritation, or sensitivity should consult a qualified hair or scalp care professional before trying new ingredients.',
      `Use "${NOT_ELIGIBLE_STATUS}" when length is too short, condition needs work, confidence is too low, or scalp coverage should be tracked before donation.`,
    ].join('\n');

    // Build multimodal content parts (text + images interleaved)
    const multimodalParts: Record<string, unknown>[] = [
      { text: textContent },
    ];

    validImages.forEach((image, index) => {
      multimodalParts.push({
        text: `Image ${index + 1}: ${image.viewLabel || image.viewKey || `Photo ${index + 1}`} - examine this photo carefully for the correct required angle, environment quality (lighting, dark areas), subject detection, background, obstructing items on the hair, scalp condition, hair shine or dullness, straight/wavy/curly/coily texture pattern, density, ends condition, visible cheek/neck or nape-to-ends donation length, back-side length when this is the back view, and consistency with the other required views. Estimate donation length only when loose or naturally hanging hair clearly shows the lower cheek/neck or nape cut-start area and the lowest natural ends. If hair is tied, clipped, folded, covered, or the ends are hidden, set length_measurable=false and estimated_length=null.`,
      });
      multimodalParts.push({
        inlineData: {
          mimeType: extractMimeType(image.dataUrl || ''),
          data: extractBase64Data(image.dataUrl || ''),
        },
      });
    });

    const contents = [{ role: 'user', parts: multimodalParts }];

    if (multimodalParts.length <= 1) {
      return createJsonResponse({ error: 'No valid image payload was provided.' }, 400);
    }

    console.info('[analyze-hair-submission] OpenRouter request prepared', {
      model,
      textPartCount: multimodalParts.filter((p) => 'text' in p).length,
      imagePartCount: multimodalParts.filter((p) => 'inlineData' in p).length,
      hasQuestionnaireAnswers: Boolean(Object.keys(questionnaireAnswers).length),
      historyEntryCount: Array.isArray(historyContext?.entries) ? historyContext.entries.length : 0,
    });

    let providerResult: { parsed: Record<string, unknown>; diagnostics: Record<string, unknown> };

    try {
      providerResult = await createStructuredResponse({
        providerMode: 'openrouter-only',
        model,
        systemInstruction: analysisInstructions,
        responseJsonSchema: analysisSchema,
        maxOutputTokens: 5000,
        temperature: 0.2,
        reasoningEffort: 'minimal',
        includeDiagnostics: true,
        contents,
      }) as { parsed: Record<string, unknown>; diagnostics: Record<string, unknown> };
    } catch (providerError) {
      const diagnostics = (providerError as { diagnostics?: Record<string, unknown> })?.diagnostics || {};
      const providerMessage = normalizeString(providerError instanceof Error ? providerError.message : String(providerError || ''));
      const providerStatus = normalizeNumber(diagnostics.provider_response_status);
      const canRecoverProviderParseFailure = (
        diagnostics.provider_request_attempted === true
        && providerStatus === 200
        && diagnostics.provider_parse_success === false
        && (
          providerMessage.toLowerCase().includes('invalid json')
          || providerMessage.toLowerCase().includes('empty response')
          || providerMessage.toLowerCase().includes('could not be parsed')
        )
      );

      if (!canRecoverProviderParseFailure) {
        const providerErrorType = normalizeString(diagnostics.provider_error_type);
        const recoverableProviderError = [
          'quota_exceeded',
          'temporary_unavailable',
          'provider_access_denied',
          'model_unavailable',
          'provider_error',
        ].includes(providerErrorType);

        if (!recoverableProviderError) {
          throw providerError;
        }

        console.warn('[analyze-hair-submission] provider unavailable; failing analysis instead of returning generic fallback', {
          concernType,
          model,
          provider: diagnostics.provider || null,
          providerStatus,
          providerErrorType,
          providerParseSuccess: diagnostics.provider_parse_success,
          message: providerMessage,
        });

        if (providerErrorType === 'quota_exceeded' || providerErrorType === 'temporary_unavailable') {
          const rawAnalysis = {
            is_hair_detected: true,
            invalid_image_reason: '',
            missing_views: [],
            per_view_notes: Array.from(providedViews).map((view) => ({
              view,
              clearly_visible: true,
              notes: 'The AI provider was busy, so this view was saved for low-confidence progress tracking only.',
            })),
            estimated_length: 0,
            detected_color: 'Black',
            detected_texture: 'Straight',
            detected_density: 'Medium',
            detected_condition: 'Needs manual hair review',
            visible_damage_notes: 'Hair is visible in the submitted photos. Detailed visible damage scoring should be confirmed during manual screening.',
            confidence_score: 0.25,
            shine_level: 5,
            frizz_level: 5,
            dryness_level: 5,
            oiliness_level: 5,
            damage_level: 5,
            bald_spots_present: false,
            affected_regions: ['none'],
            hair_density_score: 50,
            shedding_level: 'mild',
            visible_scalp_area: 'low',
            scalp_coverage_notes: 'Scalp coverage is marked for progress tracking from the visible scalp and part-line areas.',
            dandruff_detected: false,
            dandruff_severity: 'none',
            dandruff_notes: 'No visible dandruff-like flakes were confirmed because detailed provider analysis was unavailable.',
            lice_detected: false,
            lice_confidence: 'none',
            lice_notes: 'No visible lice or nit-like signs were confirmed because detailed provider analysis was unavailable.',
            improvement_tracking_status: 'Needs improvement tracking',
            improvement_recommendation: 'Use gentle scalp care, avoid tight hairstyles, and track coverage or shedding changes over time.',
            decision: IMPROVE_STATUS,
            summary: 'Hair analysis reached the AI provider, but the provider was busy. This low-confidence screening uses conservative values and still needs manual review.',
            length_assessment: 'Visible hair length should be confirmed during manual screening because the automated estimate was conservative.',
            donation_readiness_note: '',
            history_assessment: inferHistoryAssessment(historyContext, 'Needs manual hair review', null),
            recommendations: [],
          };

          const analysis = {
            ...normalizeAnalysisPayload(
              rawAnalysis,
              Array.from(providedViews),
              concernType,
              donationRequirementContext,
              questionnaireAnswers,
              historyContext,
            ),
            recommendations: [],
          };

          return createJsonResponse({
            success: true,
            provider: String(diagnostics.provider || 'openrouter'),
            provider_model: diagnostics.provider_model || null,
            edge_function_invoked: true,
            provider_request_attempted: diagnostics.provider_request_attempted ?? true,
            provider_response_status: providerStatus,
            provider_parse_success: true,
            recovered_from_provider_error: true,
            provider_error_type: providerErrorType,
            fallback_from_provider: diagnostics.fallback_from_provider || null,
            fallback_from_provider_error_type: diagnostics.fallback_from_provider_error_type || null,
            fallback_from_provider_response_status: diagnostics.fallback_from_provider_response_status ?? null,
            fallback_from_provider_model: diagnostics.fallback_from_provider_model || null,
            analysis,
          });
        }

        throw providerError;
      }

      console.warn('[analyze-hair-submission] provider returned unparseable JSON; failing analysis instead of returning generic fallback', {
        concernType,
        model,
        providerStatus,
        providerParseSuccess: diagnostics.provider_parse_success,
        message: providerMessage,
      });

      throw providerError;
    }

    const result = providerResult?.parsed || {};
    const diagnostics = providerResult?.diagnostics || {
      provider: 'openrouter',
      provider_request_attempted: true,
      provider_response_status: null,
      provider_parse_success: false,
      provider_model: model,
    };

    console.info('[analyze-hair-submission] OpenRouter response parsed successfully', {
      model: diagnostics.provider_model,
      responseKeys: result && typeof result === 'object' ? Object.keys(result) : [],
      hasAnalysisEnvelope: Boolean(result?.analysis),
      providerResponseStatus: diagnostics.provider_response_status,
      providerParseSuccess: diagnostics.provider_parse_success,
    });

    const rawAnalysisSource = result?.analysis && typeof result.analysis === 'object'
      ? result.analysis
      : result;
    let rawAnalysis = (
      rawAnalysisSource && typeof rawAnalysisSource === 'object' ? rawAnalysisSource : {}
    ) as Record<string, unknown>;
    let focusedLengthFallbackRan = false;

    if (hasIncompleteCriticalAnalysisFields(rawAnalysis)) {
      console.warn('[analyze-hair-submission] incomplete analysis detected', {
        concernType,
        responseKeys: result && typeof result === 'object' ? Object.keys(result) : [],
        usedTopLevelAnalysis: !Boolean(result?.analysis),
        hasSummary: Boolean(normalizeString(rawAnalysis?.summary)),
        hasDetectedColor: Boolean(normalizeString(rawAnalysis?.detected_color)),
        hasLengthAssessment: Boolean(normalizeString(rawAnalysis?.length_assessment)),
        hasDetectedCondition: Boolean(normalizeString(rawAnalysis?.detected_condition)),
        recommendationCount: normalizeRecommendationsV2(rawAnalysis?.recommendations).length,
      });
      const focusedFallbackAnalysis = await runFocusedLengthFallback({
        model,
        contents,
        providedViews: Array.from(providedViews),
      });
      focusedLengthFallbackRan = true;

      if (!focusedFallbackAnalysis) {
        return createJsonResponse({
          error: 'The AI provider returned an incomplete hair analysis. Please tap Try again so the photos can be analyzed by the provider again.',
          edge_function_invoked: true,
          provider: String(diagnostics.provider || 'openrouter'),
          provider_request_attempted: diagnostics.provider_request_attempted ?? true,
          provider_response_status: diagnostics.provider_response_status ?? null,
          provider_parse_success: diagnostics.provider_parse_success ?? false,
          error_type: 'insufficient_detail',
        }, 502);
      }

      rawAnalysis = focusedFallbackAnalysis;
    }

    const rawLengthEvidence = [
      normalizeString(rawAnalysis?.length_assessment),
      normalizeString(rawAnalysis?.length_limit_reason),
      normalizeString(rawAnalysis?.summary),
      ...normalizePerViewNotes(rawAnalysis?.per_view_notes).map((item) => item.notes),
    ].join(' ');
    const rawLengthUnmeasurable = rawAnalysis?.length_measurable === false
      || hasUnmeasurableLengthEvidence(rawLengthEvidence);
    const isEstimatedLengthMissing = normalizeNumber(rawAnalysis?.estimated_length) == null
      && !rawLengthUnmeasurable;
    if (isEstimatedLengthMissing && !focusedLengthFallbackRan) {
      console.warn('[analyze-hair-submission] estimated length missing; running focused length fallback', {
        concernType,
        hasSummary: Boolean(normalizeString(rawAnalysis?.summary)),
        hasDetectedColor: Boolean(normalizeString(rawAnalysis?.detected_color)),
        hasLengthAssessment: Boolean(normalizeString(rawAnalysis?.length_assessment)),
        hasDetectedCondition: Boolean(normalizeString(rawAnalysis?.detected_condition)),
        recommendationCount: normalizeRecommendationsV2(rawAnalysis?.recommendations).length,
      });

      const focusedFallbackAnalysis = await runFocusedLengthFallback({
        model,
        contents,
        providedViews: Array.from(providedViews),
      });
      focusedLengthFallbackRan = true;

      const fallbackLength = normalizeNumber(focusedFallbackAnalysis?.estimated_length);
      if (focusedFallbackAnalysis && fallbackLength != null) {
        rawAnalysis = {
          ...rawAnalysis,
          estimated_length: fallbackLength,
          length_measurable: focusedFallbackAnalysis.length_measurable !== false,
          length_limit_reason: normalizeString(focusedFallbackAnalysis.length_limit_reason),
          length_assessment: normalizeString(focusedFallbackAnalysis.length_assessment)
            || normalizeString(rawAnalysis.length_assessment)
            || `Focused fallback estimated visible cheek/neck-to-ends donation length at about ${formatLengthInches(fallbackLength)}.`,
          per_view_notes: Array.isArray(rawAnalysis.per_view_notes) && rawAnalysis.per_view_notes.length
            ? rawAnalysis.per_view_notes
            : focusedFallbackAnalysis.per_view_notes,
          confidence_score: Math.max(
            normalizeConfidence(rawAnalysis.confidence_score) ?? 0,
            normalizeConfidence(focusedFallbackAnalysis.confidence_score) ?? 0,
          ),
          summary: normalizeString(rawAnalysis.summary) || focusedFallbackAnalysis.summary,
          recommendations: normalizeRecommendationsV2(rawAnalysis.recommendations).length
            ? rawAnalysis.recommendations
            : focusedFallbackAnalysis.recommendations,
        };
      } else {
        console.warn('[analyze-hair-submission] focused length fallback could not provide estimated length', {
          hasFallbackAnalysis: Boolean(focusedFallbackAnalysis),
          fallbackLength,
          fallbackLengthAssessment: normalizeString(focusedFallbackAnalysis?.length_assessment),
        });
      }
    }

    const analysis = normalizeAnalysisPayload(
      rawAnalysis,
      Array.from(providedViews),
      concernType,
      donationRequirementContext,
      questionnaireAnswers,
      historyContext,
    );

    console.info('[analyze-hair-submission] google ai result ready', {
      concernType,
      hasAnalysis: Boolean(analysis),
      isHairDetected: analysis?.is_hair_detected ?? null,
      missingViews: Array.isArray(analysis?.missing_views) ? analysis.missing_views : [],
      decision: analysis?.decision || '',
      detectedColor: analysis?.detected_color || '',
      estimatedLength: analysis?.estimated_length ?? null,
      hasLengthAssessment: Boolean(analysis?.length_assessment),
      focusedLengthFallbackRan,
      recommendationCount: Array.isArray(analysis?.recommendations) ? analysis.recommendations.length : 0,
    });

    return createJsonResponse({
      success: true,
      provider: String(diagnostics.provider || 'openrouter'),
      provider_model: diagnostics.provider_model || null,
      edge_function_invoked: true,
      provider_request_attempted: diagnostics.provider_request_attempted,
      provider_response_status: diagnostics.provider_response_status,
      provider_parse_success: diagnostics.provider_parse_success,
      analysis,
    });
  } catch (error) {
    console.error('[analyze-hair-submission]', error);
    const safeError = resolveSafeAnalysisError(error);
    const diagnostics = (error as { diagnostics?: {
      provider?: string;
      provider_request_attempted?: boolean;
      provider_response_status?: number | null;
      provider_parse_success?: boolean;
      provider_model?: string | null;
      provider_error_type?: string;
      provider_finish_reason?: string | null;
      provider_native_finish_reason?: string | null;
      fallback_from_provider?: string | null;
      fallback_from_provider_error_type?: string | null;
      fallback_from_provider_response_status?: number | null;
      fallback_from_provider_model?: string | null;
      retry_after_seconds?: number | null;
    } })?.diagnostics;

    return createJsonResponse({
      error: safeError.message,
      edge_function_invoked: true,
      provider: diagnostics?.provider || 'openrouter',
      provider_model: diagnostics?.provider_model || null,
      provider_request_attempted: diagnostics?.provider_request_attempted ?? false,
      provider_response_status: diagnostics?.provider_response_status ?? null,
      provider_parse_success: diagnostics?.provider_parse_success ?? false,
      error_type: diagnostics?.provider_error_type || null,
      provider_finish_reason: diagnostics?.provider_finish_reason || null,
      provider_native_finish_reason: diagnostics?.provider_native_finish_reason || null,
      fallback_from_provider: diagnostics?.fallback_from_provider || null,
      fallback_from_provider_error_type: diagnostics?.fallback_from_provider_error_type || null,
      fallback_from_provider_response_status: diagnostics?.fallback_from_provider_response_status ?? null,
      fallback_from_provider_model: diagnostics?.fallback_from_provider_model || null,
      retry_after_seconds: diagnostics?.retry_after_seconds ?? null,
    }, safeError.status);
  }
});

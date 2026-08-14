/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Stack } from "@lezer/lr";
import { contextualKeywordNames, reservedKeywordNames } from "../keywords.generated.js";
import * as terms from "./generated/tsqlParser.terms.js";

const keywordTerms = new Map<string, number>();
for (const [termName, term] of Object.entries(terms as Readonly<Record<string, number>>)) {
    if (typeof term === "number") keywordTerms.set(normalize(termName), term);
}

// SqlParser's context catalog intentionally omits several parser-local option words. They remain
// non-reserved identifiers outside a grammar position that requests their specialized terminal.
const parserLocalContextWords = new Set(
    `abort action always ansidefaults ansinulldfltoff ansinulldflton ansinulls ansipadding cast
     ansiwarnings apply arithabort arithignore at caller catch changes changetable columnstore
     committed concatnullyieldsnull cookie cube cursorcloseoncommit datefirst dateformat
     chunkusing copy deadlockpriority delay delayeddurability disable dropexisting dynamic edge enable encrypted externalmodel fastforward
     filestreamon filetable first fmtonly following forceplan forwardonly function generated global graph
     fulltextstoplist grouping groups hidden high identityinsert implicittransactions include increment io isolation json keyset
     language lastnode level local locktimeout login low masked matched maxvalue minvalue name next no nocount noexec node normal
     maxdop numericroundabort off offset only optimistic out output parameters parseonly partition partitions pause
     period persisted preceding profile querygovernorcostlimit quotedidentifier range readonly rebuild
     remoteproctransactions reorganize repeatable restart resume rollup row rows scroll scrolllocks
     sequence sequencenumber serializable sets shortestpath showplanall showplantext showplanxml snapshot source sparse start
     searchtype semantic static statistics switch synonym systemtime target textimageon throw ties time timeout transactionid try
     trycast type typewarning unbounded uncommitted using value vector vectorindex version window within xactabort xml xmldata xmlschema
     cache cycle absent active after absolute affinity aggregate algorithm any assembly asymmetric attested audit authentication auto availability base64 begindialog binary buffer bulklogged called catalog checkexpiration checkpolicy clear close cluster collection configuration connect contained contains content context cpu diagnostics
     containment contract control credential cryptographic data datasource deallocate decryption defaultdatabase defaultlanguage dependents disk elements empty environmentvariables explicit
     endpoint executable extract extension fn connection definition
     defaultschema distribution encryption file fileformat filegroup filegrowth filelistonly filename format formatoptions
     failover force forcefailoverallowdataloss fullscan fulltext hadr hashed headeronly holdlock identity incremental initiator instead labelonly last location
     heap impersonate includenullvalues kill library log master maxlength maxsize member message mirror mustchange nativecompilation none norecompute nowait numanode object objectid offline oldpassword online open page parameters path permissionset platform population process property
     input owner override partial password private prior provider pushdown queue raw reconfigure recompile regenerate relative remove modify replica resample root returns role sample scoped self server shutdown sid
     policy pool privileges raw readtext reconfigure reset resource role rule scheduler security secret secondary selective sent service singleton softnuma spatial specification sql state statisticalsemantics stop stoplist symmetric system schemabinding timestamp updatetext writetext
     scheme simple size split take tape target ownership transfer unchecked unlock url used validation validxml varying verifyonly visibility wellformedxml governor reset resource workload
     windows without withoutarraywrapper xmlnamespaces xquery xsinil`
        .split(/\s+/u)
        .filter(Boolean),
);

const reservedTerms = keywordTermSubset(reservedKeywordNames);
const contextualTerms = keywordTermSubset([...contextualKeywordNames, ...parserLocalContextWords]);

export function reservedKeyword(value: string, _stack: Stack): number {
    return reservedTerms.get(normalize(value)) ?? -1;
}

export function contextualKeyword(value: string, stack: Stack): number {
    void stack;
    const normalized = normalize(value);
    const term = contextualTerms.get(normalized);
    return term ?? -1;
}

function keywordTermSubset(words: Iterable<string>): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const word of words) {
        const normalized = normalize(word);
        const term = keywordTerms.get(normalized);
        if (term !== undefined) result.set(normalized, term);
    }
    return result;
}

// Readable grammar terms use PascalCase while SQL spellings may contain underscores.
function normalize(value: string): string {
    return value.replaceAll("_", "").toLowerCase();
}
